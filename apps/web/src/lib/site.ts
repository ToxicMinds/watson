// Where Watson lives, and whether search engines may list it. Off until launch: the front page
// shows sample practitioners and the address is Render's, not Watson's own domain yet.
// At launch: remove the samples (scripts/sample-practitioners.mjs remove), point SITE_URL at the
// new domain, and set LISTED to true.
export const SITE_URL = "https://watson-assists.onrender.com";
export const LISTED = false;
