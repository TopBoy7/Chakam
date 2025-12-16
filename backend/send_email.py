import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging

logger = logging.getLogger(__name__)

class EmailService:
    @staticmethod
    def send_email(to_email: str, subject: str, body: str, html: bool = True):
        try:
            msg = MIMEMultipart() if html else MIMEText(body, "plain")
            msg["From"] = os.getenv("SMTP_EMAIL")  # From environment
            msg["To"] = to_email
            msg["Subject"] = subject
            if html:
                msg.attach(MIMEText(body, "html"))
            else:
                msg.attach(MIMEText(body, "plain"))
            server = smtplib.SMTP("smtp.gmail.com", 587, timeout=30)
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(msg["From"], os.getenv("SMTP_PASSWORD"))
            server.send_message(msg)
            server.quit()
            return True
        except Exception as e:
            logger.exception(f"Error sending email: {e}")
            return False

    @staticmethod
    def send_occupancy_alert(
        to_email: str,
        class_id: str,
        class_name: str,
        occupancy: int,
        capacity: int
    ):
        subject = f"⚠️ Capacity Alert: {class_name} ({class_id})"

        body = fhtml = f"""
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