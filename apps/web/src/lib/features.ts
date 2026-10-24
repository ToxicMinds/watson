// Parts that need an online service. The hosted Watson has both; on one computer (scripts/local.sh)
// they are off unless set up, so nothing there offers what cannot work (owner, 24 Oct 2026).
export const PAYMENTS = process.env.NEXT_PUBLIC_PAYMENTS !== "off";
export const GOOGLE_CALENDAR = process.env.NEXT_PUBLIC_GOOGLE_CALENDAR !== "off";
