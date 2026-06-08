import os
import json
import logging
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)


class EmailService:
    """Sends email EXCLUSIVELY through the external HTTP mailer API (MAILER_URL).

    There is no direct-SMTP path: some hosts (e.g. Render's free tier) block
    outbound SMTP, and we want one consistent behaviour everywhere. The mailer
    service (the `mailer/` Next.js app) does the actual SMTP sending.

    Shared by both main.py and main-light.py, so the two backends behave
    identically. Uses only the standard library — no extra dependencies.
    """

    @staticmethod
    def _send_via_api(to_email: str, subject: str, body: str) -> bool:
        url = os.getenv("MAILER_URL")
        if not url:
            logger.error("MAILER_URL is not set — email cannot be sent (API-only).")
            return False

        payload = json.dumps({"to": to_email, "subject": subject, "body": body}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        secret = os.getenv("MAILER_SECRET")
        if secret:
            headers["x-mailer-secret"] = secret

        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                ok = 200 <= resp.status < 300
                if not ok:
                    logger.error("Mailer API non-2xx status: %s", resp.status)
                return ok
        except urllib.error.HTTPError as e:
            logger.error("Mailer API HTTP error %s: %s", e.code, e.read().decode("utf-8", "ignore"))
            return False
        except Exception as e:
            logger.exception("Mailer API request failed: %s", e)
            return False

    @staticmethod
    def send_email(to_email: str, subject: str, body: str, html: bool = True) -> bool:
        """Send an email via the mailer API. Returns True on success.
        `html` is kept for signature compatibility; the mailer always sends HTML."""
        return EmailService._send_via_api(to_email, subject, body)

    @staticmethod
    def send_occupancy_alert(
        to_email: str,
        class_id: str,
        class_name: str,
        occupancy: int,
        capacity: int,
    ):
        subject = f"⚠️ Capacity Alert: {class_name} ({class_id})"

        body = f"""
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#f9fafb; font-family: Arial, Helvetica, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table width="100%" style="max-width:520px; background:#ffffff; border-radius:8px; padding:24px;">

            <tr>
              <td align="center" style="padding-bottom:16px;">
                <img src="https://res.cloudinary.com/dtgigdp2j/image/upload/v1765901415/random/cam_ldfi1n.png" alt="Chakam" width="48" height="48" />
              </td>
            </tr>

            <tr>
              <td align="center">
                <h2 style="margin:0 0 16px; color:#111827;">
                  Classroom Capacity Exceeded
                </h2>
              </td>
            </tr>

            <tr>
              <td style="color:#374151; font-size:15px; line-height:1.6;">
                <p style="margin:0 0 12px;">
                  The classroom <strong>{class_name}</strong> (ID: {class_id})
                  has exceeded its allowed capacity.
                </p>

                <p style="margin:0 0 12px;">
                  <strong>Occupancy:</strong> {occupancy}<br />
                  <strong>Capacity:</strong> {capacity}
                </p>

                <p style="margin:0;">
                  Please take immediate action.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding-top:24px; border-top:1px solid #e5e7eb;">
                <p style="margin:0; font-size:13px; color:#6b7280; text-align:center;">
                  Smart Classroom System<br />
                  <strong>Chakam</strong>
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""

        return EmailService.send_email(to_email, subject, body, html=True)
