# Run Watson on your own Mac

Everything runs on your Mac: the database, sign-in and files (in Docker), Watson's engine (transcripts,
documents and forms) and the website. Nothing you do here reaches the hosted Watson or anyone else.
You play both people: the doctor in one browser window, the patient in another.

## What you need

- A Mac with Apple silicon (M1 or later). 16 GB of memory is comfortable; 8 GB works, slowly.
- About 15 GB of free disk space: Docker's images and the engine's speech and form models.
- [Homebrew](https://brew.sh).
- [Docker Desktop](https://www.docker.com/products/docker-desktop/), free for personal use and small
  businesses. Open it once and wait until it says it is running.

The setup installs everything else it needs with Homebrew: Node, pnpm, Supabase's command-line tool and uv.

## Set up, once

    git clone https://github.com/watson-assists/watson.git
    cd watson
    scripts/local.sh setup

The first time takes 20 to 40 minutes, mostly downloads. It ends with "Set up". If a step fails, it says
what is missing; fix that and run it again (it picks up where it can).

## Use it

    scripts/local.sh start

Open http://localhost:3000 and sign in with the name and password it prints (name `doctor`; the
password is also in `.local/logins.env`). Then:

1. **New consultation**: the patient's name and email (any), the language, **Create consultation**.
2. **Start video call**, then **Start video call** again. Allow the camera and microphone.
3. Copy the patient's link, open it in a private window, and **Join the call** there.
4. Talk for a few minutes, then **End call** in the doctor's window.
5. The transcript is ready in a minute or two, and the form a few minutes later: **Check the form**.

The form is a sample Ayurvedic intake with invented questions. Practice holds your hours and the page
patients would see; on this Mac nobody else can book.

To prove the whole chain works without doing it by hand:

    scripts/local.sh check

It signs in, makes a call with a recorded voice, and waits for the transcript and the form (about ten
minutes). When you are done:

    scripts/local.sh stop

Your consultations stay in Docker until you remove them; `supabase db reset` empties the database
(then run `scripts/local.sh setup` again for the logins).

## Payments and Google Calendar (optional, off)

Both need online services, so they are hidden until you add Watson's test keys. Ask Nikhil for them
and put them in `.local/online.env`:

    STRIPE_SECRET_KEY=rk_test_...
    GOOGLE_CLIENT_ID=...apps.googleusercontent.com
    GOOGLE_CLIENT_SECRET=GOCSPX-...

Then `scripts/local.sh stop` and `scripts/local.sh start`. Fees appear again; patients pay on Stripe's
test page with the card 4242 4242 4242 4242 (no real money). Google Calendar appears in Practice. Google
lets only the accounts Nikhil has added connect, so send Nikhil the Gmail address you will use.

## If something goes wrong

- "Docker is not running": open Docker Desktop and wait until it is running.
- A port is in use (3000, or 54321 to 54324): close what uses it, or stop an older Watson with
  `scripts/local.sh stop`.
- Logs: `.local/web.log`, `.local/engine.log` and, with online services, `.local/functions.log`.
- Patients on other phones or computers cannot reach a Watson on your Mac; that needs the hosted
  Watson at https://watson-assists.onrender.com.
- After `git pull`, `scripts/local.sh start` applies the database changes that came with it. If the
  doctor login says it may not do something ("Practitioner role required"), run
  `node scripts/local-accounts.mjs` once: it gives the doctor login its role again.
- Patient sign-in (a code by email or WhatsApp) needs Watson's online services, so on this Mac it says
  it could not send a code. Everything else works offline. Calls stay on this Mac, with no relay.
