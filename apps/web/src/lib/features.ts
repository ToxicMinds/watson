// Parts that need an online service. The hosted Watson has both; on one computer (scripts/local.sh)
// they are off unless set up, so nothing there offers what cannot work (owner, 24 Oct 2026).
export const PAYMENTS = process.env.NEXT_PUBLIC_PAYMENTS !== "off";
export const GOOGLE_CALENDAR = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR !== "off";
// The call relay (TURN, the ice edge function) is for calls across the internet. A Watson on one computer
// serves only that computer or its network, where browsers reach each other directly: no relay to ask for.
export const RELAY = !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
