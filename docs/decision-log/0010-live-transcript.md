# 0010 A live transcript beside the call, always on

Date: 24 October 2026. Decided by the owner.

The owner asked for the transcript "side-by-side live, like it happens in Teams", and chose to have it
on for every call, knowing it uses the cloud engine's free monthly allowance faster: about 6 calls a
month inside Modal's $1 instead of about 25, with an email to the owner when the allowance is used.

How it works: while the call is recorded, the doctor's browser also records each voice in ten-second
pieces and sends them; the cloud engine reads them before any other work, writes their text for the
call screen (about fifteen seconds behind) and removes each file. Pieces of an ended call, or older than
ten minutes, are set aside unread and their files removed. The transcript after the call is still made
from the complete recordings (migrations `20261024120000_live_transcript.sql` and
`20261024130000_live_pieces_cleanup.sql`).

Not chosen: the browser's own speech recognition (Chrome sends the audio to Google; Firefox has none),
and a model in the browser (too weak for Slovak, and heavy beside a video call).
