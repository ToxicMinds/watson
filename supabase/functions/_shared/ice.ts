// Where a call's browsers look for each other. STUN finds each browser's own address; when they
// still cannot reach each other (a phone on a mobile network sits behind its carrier's shared
// address), a TURN relay carries the call. Watson's relay is Cloudflare's, free up to 1,000 GB a month.

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

/** Public STUN servers: enough on most home and office networks, and all a call has without a relay. */
export const STUN: IceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

/** How long a call's relay credentials last: longer than any consultation. */
export const RELAY_SECONDS = 4 * 60 * 60;

// The addresses a call needs from Cloudflare's list; Firefox slows down, and warns, from five addresses on.
const WANTED = [
  /^stun:[^?]+:3478$/, // STUN
  /^turn:[^?]+:3478\?transport=udp$/, // TURN over UDP: the usual relay
  /^turns:[^?]+:443\?transport=tcp$/, // TURN over TLS on 443: gets through networks that allow only web traffic
];

/** From Cloudflare's servers, STUN, TURN over UDP and TURN over TLS on 443, with their credentials. */
export function usable(servers: IceServer[]): IceServer[] {
  return servers
    .map((server) => ({ ...server, urls: [server.urls].flat().filter((url) => WANTED.some((wanted) => wanted.test(url))) }))
    .filter((server) => server.urls.length > 0);
}
