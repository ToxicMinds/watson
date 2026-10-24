// Limits and formats: MASTER_BUILD_SPEC.md section 11.
export const FORMATS = ["wav", "mp3", "m4a", "mp4", "flac", "ogg", "webm"] as const;
export type AudioFormat = (typeof FORMATS)[number];
export const MAX_SECONDS = 2 * 60 * 60;

const MIME: Record<AudioFormat, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  flac: "audio/flac",
  ogg: "audio/ogg",
  webm: "audio/webm",
};
export const mimeOf = (format: AudioFormat) => MIME[format];

/** The format a browser recorder produced, from its media type. */
export function formatOfRecording(mediaType: string): AudioFormat {
  return FORMATS.find((format) => mediaType.includes(format)) ?? "webm";
}

/**
 * The format, from a file's first bytes. Browsers do not always label what they record: Firefox
 * leaves its Ogg recordings unlabelled (owner's test of 24 Oct), and the label decides the upload.
 */
export function formatOfContent(head: Uint8Array): AudioFormat | null {
  const text = (from: number, length: number) => String.fromCharCode(...head.subarray(from, from + length));
  if (text(0, 4) === "OggS") return "ogg";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm";
  if (text(4, 4) === "ftyp") return "m4a";
  if (text(0, 4) === "RIFF" && text(8, 4) === "WAVE") return "wav";
  return null;
}

/** A recording ready to upload: its format from its first bytes (else `fallback`) and the label to match. */
export async function labelled(blob: Blob, fallback: AudioFormat): Promise<{ file: Blob; format: AudioFormat }> {
  const format = formatOfContent(new Uint8Array(await blob.slice(0, 12).arrayBuffer())) ?? fallback;
  return { file: new Blob([blob], { type: mimeOf(format) }), format };
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** How long a file plays, as the browser reports it. Null when the browser cannot tell. */
export function durationOf(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const finish = (seconds: number | null) => {
      URL.revokeObjectURL(url);
      resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null);
    };
    audio.addEventListener("loadedmetadata", () => finish(audio.duration), { once: true });
    audio.addEventListener("error", () => finish(null), { once: true });
    setTimeout(() => finish(null), 5000);
    audio.preload = "metadata";
    audio.src = url;
  });
}

export function humanSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 75.4 -> "1:15". */
export function clock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
