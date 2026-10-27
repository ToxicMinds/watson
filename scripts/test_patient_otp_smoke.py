import contextlib
import importlib.util
import io
import json
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("smoke-patient-otp.py")
SPEC = importlib.util.spec_from_file_location("patient_otp_smoke", MODULE_PATH)
assert SPEC and SPEC.loader
smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(smoke)


class FakeResponse:
    def __init__(self, status, body=b""):
        self.status = status
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return None

    def read(self):
        return self.body


class PatientOtpSmokeTests(unittest.TestCase):
    def test_success_checks_role_revokes_test_session_and_never_prints_sensitive_values(self):
        calls = []
        responses = [
            FakeResponse(200, b'{"ok":true}'),
            FakeResponse(200, b'{"ok":true,"session":{"access_token":"access-secret","refresh_token":"refresh-secret"}}'),
            FakeResponse(200, b'["patient"]'),
            FakeResponse(204),
        ]

        def fake_urlopen(request, timeout):
            calls.append(request)
            return responses.pop(0)

        output = io.StringIO()
        with (
            patch.dict("os.environ", {
                "NEXT_PUBLIC_SUPABASE_URL": "https://project.supabase.co",
                "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "public-key",
            }, clear=True),
            patch("builtins.input", return_value="synthetic@example.test"),
            patch.object(smoke.getpass, "getpass", return_value="01234567"),
            patch.object(smoke.urllib.request, "urlopen", side_effect=fake_urlopen),
            contextlib.redirect_stdout(output),
        ):
            result = smoke.main()

        self.assertEqual(result, 0)
        self.assertEqual(len(calls), 4)
        self.assertEqual(json.loads(calls[0].data), {"action": "send", "email": "synthetic@example.test"})
        self.assertEqual(json.loads(calls[1].data), {
            "action": "verify", "email": "synthetic@example.test", "code": "01234567",
        })
        self.assertIn("/auth/v1/logout?scope=global", calls[3].full_url)
        self.assertNotIn("synthetic@example.test", output.getvalue())
        self.assertNotIn("01234567", output.getvalue())
        self.assertNotIn("access-secret", output.getvalue())
        self.assertNotIn("refresh-secret", output.getvalue())

    def test_refuses_missing_hosted_public_config_before_prompting(self):
        with patch.dict("os.environ", {}, clear=True), patch("builtins.input") as prompt:
            self.assertEqual(smoke.main(), 2)
            prompt.assert_not_called()


if __name__ == "__main__":
    unittest.main()
