// The live transcript during the call (owner, 24 Oct: "like it happens in Teams"): each ten-second
// piece goes to storage and is registered for the cloud engine, which writes its text back.
import { call } from "./api";
import { formatOfRecording, labelled } from "./audio";
import type { LivePiece } from "./call";
import { supabase } from "./supabase";

/** Sends one piece. Best effort: a piece that does not arrive only leaves a gap on the screen. */
export function livePieceSender(userId: string, consultationId: string): LivePiece {
  return (speaker, blob, seq, offsetSeconds) => {
    if (blob.size === 0) return;
    void (async () => {
      const { file } = await labelled(blob, formatOfRecording(blob.type));
      const path = `${userId}/${consultationId}/live/${speaker}-${seq}`;
      const { error } = await supabase.storage.from("audio").upload(path, file, { contentType: file.type });
      if (error) return;
      await call("add_live_piece", {
        p_consultation_id: consultationId, p_speaker: speaker, p_seq: seq, p_offset_seconds: Math.round(offsetSeconds * 100) / 100,
      });
    })();
  };
}

export type LiveLine = { speaker: "practitioner" | "patient"; seq: number; offset_seconds: number; text: string };

/** What the engine has written so far, in the order it was said. */
export async function liveLines(consultationId: string): Promise<LiveLine[]> {
  const { data } = await supabase.from("live_pieces").select("speaker, seq, offset_seconds, text")
    .eq("consultation_id", consultationId).eq("status", "done").order("offset_seconds");
  return ((data ?? []) as LiveLine[]).filter((line) => line.text);
}
