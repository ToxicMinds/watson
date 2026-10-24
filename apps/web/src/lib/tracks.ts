import { call, explain } from "./api";
import { durationOf, labelled, MAX_SECONDS, mimeOf, sha256Hex, type AudioFormat } from "./audio";
import type { Database } from "./database.types";
import { supabase } from "./supabase";

export type Speaker = Database["public"]["Enums"]["speaker"];

/**
 * Stores one speaker's audio and registers it as that speaker's track. Returns null when it
 * worked, otherwise a sentence the practitioner can act on. `onStep` reports progress.
 */
export async function attachAudio({ consultationId, userId, speaker, blob, format, seconds, onStep }: {
  consultationId: string;
  userId: string;
  speaker: Speaker;
  blob: Blob;
  format: AudioFormat;
  seconds: number | null;
  onStep?: (step: string) => void;
}): Promise<string | null> {
  const path = `${userId}/${consultationId}/${speaker}`;
  onStep?.("Reading the audio…");
  // The file's first bytes say what it is; the browser's label may be missing (Firefox, 24 Oct).
  const { file, format: actual } = await labelled(blob, format);
  const [sha256, length] = await Promise.all([sha256Hex(blob), seconds ?? durationOf(blob)]);
  if (length !== null && length > MAX_SECONDS) return explain("AUDIO_DURATION_INVALID");
  onStep?.(`Uploading ${speaker} audio…`);
  // Clear anything an interrupted earlier attempt left at this path, then store the file.
  await supabase.storage.from("audio").remove([path]);
  const upload = await supabase.storage.from("audio").upload(path, file, { contentType: mimeOf(actual) });
  if (upload.error) return explain("STORAGE_UNAVAILABLE");
  onStep?.("Checking…");
  const outcome = await call("register_audio_track", {
    p_consultation_id: consultationId,
    p_speaker: speaker,
    p_format: actual,
    p_size_bytes: blob.size,
    p_sha256: sha256,
    p_duration_seconds: length === null ? undefined : Math.round(length * 100) / 100,
  });
  return outcome.ok ? null : explain(outcome.error_category);
}
