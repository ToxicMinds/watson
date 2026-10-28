// The call's relay (owner, 28 Oct: a call from a phone on 5G never connected). A phone on a mobile
// network sits behind its carrier's shared address, so the two browsers cannot reach each other
// directly; a TURN relay carries the call instead. From Cloudflare's answer a call keeps the three
// addresses it needs (Firefox slows down, and warns, from five on): STUN, TURN over UDP, and TURN
// over TLS on port 443, which gets through networks that allow only web traffic.
import { describe, expect, it } from "vitest";
import { STUN, usable } from "../../../supabase/functions/_shared/ice";

const cloudflare = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:443"] },
  {
    urls: [
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turn:turn.cloudflare.com:3478?transport=tcp",
      "turns:turn.cloudflare.com:5349?transport=tcp",
      "turn:turn.cloudflare.com:443?transport=udp",
      "turn:turn.cloudflare.com:80?transport=tcp",
      "turns:turn.cloudflare.com:443?transport=tcp",
      "turn:turn.cloudflare.com:53?transport=udp",
    ],
    username: "user",
    credential: "secret",
  },
];

describe("the relay addresses a call is given", () => {
  it("are Cloudflare's STUN, TURN over UDP and TURN over TLS on 443, with the credentials", () => {
    expect(usable(cloudflare)).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
        username: "user",
        credential: "secret",
      },
    ]);
  });

  it("drops a server left with no address, and reads a single address", () => {
    expect(usable([{ urls: "stun:stun.cloudflare.com:53" }, { urls: "stun:stun.cloudflare.com:3478" }]))
      .toEqual([{ urls: ["stun:stun.cloudflare.com:3478"] }]);
  });

  it("without a relay, is the public STUN servers alone", () => {
    expect(STUN).toEqual([{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]);
  });
});
