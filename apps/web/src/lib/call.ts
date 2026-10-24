// A consultation call. Video and voice go directly between the two browsers (WebRTC); the
// Supabase channel named by the invite token carries only the handshake. Free: no media server.
import { formatOfRecording, type AudioFormat } from "./audio";
import { supabase } from "./supabase";

type Role = "doctor" | "patient";
export type CallState = "joining" | "waiting" | "connecting" | "connected" | "reconnecting" | "ended";
type Message =
  | { kind: "hello" | "bye" }
  | { kind: "offer" | "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };
type Signal = Message & { from: Role; session: string };

// Public STUN servers let each browser find its own address.
// ponytail: no relay (TURN); add one if some networks cannot connect directly.
const ICE: RTCConfiguration = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };

/** The patient's link, short enough to read out: /j/K7P4QX9M opens their page (app/j). */
export function patientLink(shortCode: string): string {
  return `${window.location.origin}/j/${shortCode}`;
}

/** Joins the call as doctor or patient. The doctor makes every offer, so either can arrive first. */
export function connect({ token, role, local, onRemote, onState }: {
  token: string;
  role: Role;
  local: MediaStream;
  onRemote: (stream: MediaStream) => void;
  onState: (state: CallState) => void;
}) {
  const session = crypto.randomUUID();
  const other: Role = role === "doctor" ? "patient" : "doctor";
  let peer: RTCPeerConnection | null = null;
  let otherSession: string | null = null;
  let waiting: RTCIceCandidateInit[] = [];
  let queue = Promise.resolve();
  const channel = supabase.channel(`call-${token}`, { config: { broadcast: { self: false } } });
  const send = (message: Message) =>
    channel.send({ type: "broadcast", event: "signal", payload: { ...message, from: role, session } });

  function fresh() {
    peer?.close();
    waiting = [];
    const created = new RTCPeerConnection(ICE);
    local.getTracks().forEach((track) => created.addTrack(track, local));
    created.onicecandidate = ({ candidate }) => {
      if (candidate) void send({ kind: "ice", candidate: candidate.toJSON() });
    };
    created.ontrack = ({ streams }) => streams[0] && onRemote(streams[0]);
    created.onconnectionstatechange = () => {
      if (created !== peer) return;
      if (created.connectionState === "connected") onState("connected");
      if (created.connectionState === "disconnected" || created.connectionState === "failed") onState("reconnecting");
    };
    peer = created;
    onState("connecting");
    return created;
  }

  async function flush() {
    for (const candidate of waiting) await peer?.addIceCandidate(candidate);
    waiting = [];
  }

  async function handle(signal: Signal) {
    if (signal.from !== other) return;
    if (signal.kind === "hello") {
      // A new session on the other side (it arrived or reloaded) needs a new connection.
      if (signal.session === otherSession && peer) return;
      otherSession = signal.session;
      if (role === "patient") return void (await send({ kind: "hello" }));
      const created = fresh();
      await created.setLocalDescription(await created.createOffer());
      await send({ kind: "offer", sdp: created.localDescription!.toJSON() });
    } else if (signal.kind === "offer") {
      otherSession = signal.session;
      const created = fresh();
      await created.setRemoteDescription(signal.sdp);
      await flush();
      await created.setLocalDescription(await created.createAnswer());
      await send({ kind: "answer", sdp: created.localDescription!.toJSON() });
    } else if (signal.kind === "answer") {
      await peer?.setRemoteDescription(signal.sdp);
      await flush();
    } else if (signal.kind === "ice") {
      if (peer?.remoteDescription) await peer.addIceCandidate(signal.candidate);
      else waiting.push(signal.candidate);
    } else if (signal.kind === "bye") {
      peer?.close();
      peer = null;
      otherSession = null;
      onState(role === "patient" ? "ended" : "waiting");
    }
  }

  channel.on("broadcast", { event: "signal" }, ({ payload }) => {
    // One message at a time, in order: a handshake step must finish before the next starts.
    queue = queue.then(() => handle(payload as Signal)).catch(() => onState("reconnecting"));
  });
  onState("joining");
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      onState("waiting");
      void send({ kind: "hello" });
    }
  });

  return {
    async leave() {
      await send({ kind: "bye" });
      peer?.close();
      peer = null;
      await supabase.removeChannel(channel);
      onState("ended");
    },
  };
}

export type Recording = { practitioner: Blob; patient: Blob; format: AudioFormat; seconds: number };

/** One live piece of the call: a voice, its number in turn, and when it starts in the recording. */
export type LivePiece = (speaker: "practitioner" | "patient", blob: Blob, seq: number, offsetSeconds: number) => void;
const PIECE_MS = 10_000;

/**
 * Ten-second pieces of one voice, each a file of its own, for the live transcript (owner, 24 Oct:
 * "like it happens in Teams"). Recorded beside the full track, which stays the one that counts.
 */
function pieces(stream: MediaStream, startedAt: number, onPiece: (blob: Blob, seq: number, offset: number) => void) {
  let count = 0;
  let current: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = true;
  const next = () => {
    if (!running) return;
    const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 32_000 });
    const parts: Blob[] = [];
    const seq = count++;
    const offset = (performance.now() - startedAt) / 1000;
    recorder.addEventListener("dataavailable", (event) => parts.push(event.data));
    recorder.addEventListener("stop", () => onPiece(new Blob(parts, { type: recorder.mimeType }), seq, offset), { once: true });
    recorder.start();
    current = recorder;
    timer = setTimeout(() => {
      recorder.stop();
      next();
    }, PIECE_MS);
  };
  next();
  return () => {
    running = false;
    clearTimeout(timer);
    if (current?.state === "recording") current.stop();
  };
}

/**
 * Records the call in the doctor's browser as two tracks on one clock: the doctor's microphone,
 * and whatever the patient's side sends. The patient's side goes through a mixer, so a
 * reconnection mid-call keeps recording into the same track.
 */
export function recordCall(local: MediaStream, onPiece?: LivePiece) {
  const context = new AudioContext();
  const patientMix = context.createMediaStreamDestination();
  const options = { audioBitsPerSecond: 32_000 }; // speech needs little; the free storage is small
  const doctorVoice = new MediaStream(local.getAudioTracks());
  const practitioner = new MediaRecorder(doctorVoice, options);
  const patient = new MediaRecorder(patientMix.stream, options);
  const chunks = { practitioner: [] as Blob[], patient: [] as Blob[] };
  practitioner.addEventListener("dataavailable", (event) => chunks.practitioner.push(event.data));
  patient.addEventListener("dataavailable", (event) => chunks.patient.push(event.data));
  let started = 0;
  let stopPieces: (() => void)[] = [];

  const stopped = (recorder: MediaRecorder) =>
    new Promise<void>((resolve) => {
      if (recorder.state === "inactive") return resolve();
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });

  return {
    get started() {
      return started > 0;
    },
    get seconds() {
      return started ? (performance.now() - started) / 1000 : 0;
    },
    addPatient(stream: MediaStream) {
      if (stream.getAudioTracks().length) context.createMediaStreamSource(stream).connect(patientMix);
    },
    start() {
      if (started) return;
      void context.resume();
      practitioner.start(1000);
      patient.start(1000);
      started = performance.now();
      if (onPiece) {
        stopPieces = [
          pieces(doctorVoice, started, (blob, seq, offset) => onPiece("practitioner", blob, seq, offset)),
          pieces(patientMix.stream, started, (blob, seq, offset) => onPiece("patient", blob, seq, offset)),
        ];
      }
    },
    async stop(): Promise<Recording | null> {
      if (!started) return null;
      const seconds = (performance.now() - started) / 1000;
      stopPieces.forEach((stop) => stop());
      await Promise.all([stopped(practitioner), stopped(patient)]);
      void context.close();
      const type = practitioner.mimeType;
      return {
        practitioner: new Blob(chunks.practitioner, { type }),
        patient: new Blob(chunks.patient, { type: patient.mimeType }),
        format: formatOfRecording(type),
        seconds,
      };
    },
  };
}
