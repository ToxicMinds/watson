import { describe, expect, it } from "vitest";
import { clock, formatOfContent, formatOfRecording, humanSize, sha256Hex } from "./audio";

describe("audio helpers", () => {
  it("reads the format of a browser recording from its media type", () => {
    expect(formatOfRecording("audio/webm;codecs=opus")).toBe("webm");
    expect(formatOfRecording("audio/ogg; codecs=opus")).toBe("ogg");
    expect(formatOfRecording("audio/mp4")).toBe("mp4");
  });

  it("hashes content with SHA-256", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("formats sizes and durations for people", () => {
    expect(humanSize(330284)).toBe("323 KB");
    expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(clock(7.49)).toBe("0:07");
    expect(clock(75.4)).toBe("1:15");
  });
});

// Firefox records Ogg and leaves the recording unlabelled (owner's test of 24 Oct): Watson tells
// the format from the file's first bytes instead of trusting the browser's label.
describe("the format of a recording, from its first bytes", () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

  it("knows Ogg, WebM, MP4 and WAV", () => {
    expect(formatOfContent(bytes("OggS", [0, 2, 0, 0]))).toBe("ogg");
    expect(formatOfContent(bytes([0x1a, 0x45, 0xdf, 0xa3], [0x9f, 0x42, 0x86]))).toBe("webm");
    expect(formatOfContent(bytes([0, 0, 0, 0x20], "ftypM4A ", [0, 0]))).toBe("m4a");
    expect(formatOfContent(bytes("RIFF", [0x24, 0, 0, 0], "WAVE"))).toBe("wav");
  });

  it("says nothing about bytes it does not know", () => {
    expect(formatOfContent(bytes("<html>"))).toBeNull();
    expect(formatOfContent(new Uint8Array())).toBeNull();
  });
});
