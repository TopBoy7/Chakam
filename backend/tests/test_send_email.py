"""Tests for the EmailService transport selection (HTTP mailer API vs SMTP)."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import send_email  # noqa: E402
from send_email import EmailService  # noqa: E402


class EmailTransportTests(unittest.TestCase):
    def test_uses_api_when_mailer_url_set(self):
        with patch.dict("os.environ", {"MAILER_URL": "https://mail.example.com/api/send",
                                       "MAILER_SECRET": "s3cret"}, clear=False), \
             patch.object(EmailService, "_send_via_api", return_value=True) as api, \
             patch.object(EmailService, "_send_via_smtp", return_value=True) as smtp:
            ok = EmailService.send_email("to@x.com", "subj", "<b>hi</b>")
        self.assertTrue(ok)
        api.assert_called_once()
        smtp.assert_not_called()  # API succeeded → SMTP not attempted

    def test_falls_back_to_smtp_when_api_fails(self):
        with patch.dict("os.environ", {"MAILER_URL": "https://mail.example.com/api/send"}, clear=False), \
             patch.object(EmailService, "_send_via_api", return_value=False) as api, \
             patch.object(EmailService, "_send_via_smtp", return_value=True) as smtp:
            ok = EmailService.send_email("to@x.com", "subj", "<b>hi</b>")
        self.assertTrue(ok)
        api.assert_called_once()
        smtp.assert_called_once()

    def test_uses_smtp_when_no_mailer_url(self):
        env = {k: v for k, v in __import__("os").environ.items() if k != "MAILER_URL"}
        with patch.dict("os.environ", env, clear=True), \
             patch.object(EmailService, "_send_via_api", return_value=True) as api, \
             patch.object(EmailService, "_send_via_smtp", return_value=True) as smtp:
            ok = EmailService.send_email("to@x.com", "subj", "<b>hi</b>")
        self.assertTrue(ok)
        api.assert_not_called()
        smtp.assert_called_once()

    def test_send_via_api_posts_with_secret_header(self):
        captured = {}

        class FakeResp:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *a): return False

        def fake_urlopen(req, timeout=None):
            captured["url"] = req.full_url
            captured["data"] = req.data
            captured["secret"] = req.headers.get("X-mailer-secret")
            return FakeResp()

        with patch.dict("os.environ", {"MAILER_URL": "https://mail.example.com/api/send",
                                       "MAILER_SECRET": "abc123"}, clear=False), \
             patch.object(send_email.urllib.request, "urlopen", side_effect=fake_urlopen):
            ok = EmailService._send_via_api("to@x.com", "Subject", "<b>body</b>")

        self.assertTrue(ok)
        self.assertEqual(captured["url"], "https://mail.example.com/api/send")
        self.assertEqual(captured["secret"], "abc123")
        self.assertIn(b"to@x.com", captured["data"])


if __name__ == "__main__":
    unittest.main()
