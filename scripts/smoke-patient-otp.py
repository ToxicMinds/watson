#!/usr/bin/env python3
"""Send one real OTP to a synthetic inbox, verify it, check patient role, then revoke session."""

import getpass
import json
import os
import re
import sys
import urllib.error
import urllib.request


def main() -> int:
    api_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
    public_key = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    site_url = os.environ.get("WATSON_PUBLIC_URL", "https://watson-assists.onrender.com").rstrip("/")
    if not api_url.startswith("https://") or not public_key:
        print("Set hosted NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY first.", file=sys.stderr)
        return 2

    email = input("Synthetic test inbox address: ").strip().lower()
    if len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        print("Invalid email address.", file=sys.stderr)
        return 2

    base_headers = {
        "apikey": public_key,
        "Content-Type": "application/json",
        "Origin": site_url,
    }

    def post(path: str, body: dict, token: str | None = None):
        headers = dict(base_headers)
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(
            f"{api_url}{path}",
            data=json.dumps(body).encode(),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            return error.code, None
        except urllib.error.URLError:
            return 0, None

    status, sent = post("/functions/v1/patient-otp", {"action": "send", "email": email})
    if status != 200 or not isinstance(sent, dict) or sent.get("ok") is not True:
        print(f"OTP send failed (HTTP {status}); response body withheld.", file=sys.stderr)
        return 1
    print("Code sent. Check synthetic inbox.")

    code = getpass.getpass("Eight-digit code: ").strip()
    if not re.fullmatch(r"\d{8}", code):
        print("Expected eight digits.", file=sys.stderr)
        return 2

    status, verified = post("/functions/v1/patient-otp", {"action": "verify", "email": email, "code": code})
    if status != 200 or not isinstance(verified, dict) or verified.get("ok") is not True:
        print(f"OTP verification failed (HTTP {status}); response body withheld.", file=sys.stderr)
        return 1

    session = verified.get("session") or {}
    access_token = session.get("access_token")
    if not access_token:
        print("No session returned; response body withheld.", file=sys.stderr)
        return 1

    status, roles = post("/rest/v1/rpc/current_user_roles", {}, access_token)
    role_ok = status == 200 and roles == ["patient"]
    if role_ok:
        print("PASS: normal Supabase session has patient role.")
    else:
        print(f"Patient role check failed (HTTP {status}); response body withheld.", file=sys.stderr)

    logout = urllib.request.Request(
        f"{api_url}/auth/v1/logout?scope=global",
        data=b"",
        headers={"apikey": public_key, "Authorization": f"Bearer {access_token}"},
        method="POST",
    )
    logout_ok = False
    try:
        with urllib.request.urlopen(logout, timeout=30) as response:
            logout_ok = response.status in (200, 204)
    except (urllib.error.HTTPError, urllib.error.URLError):
        pass
    if not logout_ok:
        print("WARNING: test session sign-out failed; revoke it in Supabase Auth.", file=sys.stderr)
    return 0 if role_ok and logout_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
