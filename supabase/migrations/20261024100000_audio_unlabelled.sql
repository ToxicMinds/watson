-- A call recorded in Firefox failed to save (owner's test of 24 October 2026): Firefox records Ogg and
-- leaves the file unlabelled, so it arrived as application/octet-stream and the audio bucket refused
-- it. The web app now labels each track from its first bytes; the bucket also accepts an unlabelled
-- file, so a page already open in a browser can still save its recording. Every track is checked
-- again when it is registered and decoded by the engine, so nothing that is not audio gets further.
update storage.buckets
  set allowed_mime_types = array['audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/flac', 'audio/ogg', 'audio/webm', 'application/octet-stream']
  where id = 'audio';
