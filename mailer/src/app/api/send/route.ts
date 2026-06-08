import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

// nodemailer needs the full Node runtime (not the Edge runtime).
export const runtime = "nodejs";
// Never cache — every call must actually send.
export const dynamic = "force-dynamic";

/**
 * POST /api/send
 * Body: { to: string, subject: string, body: string (HTML) }
 * Auth: header "x-mailer-secret" must equal MAILER_SECRET (if MAILER_SECRET is set).
 *
 * This exists because some hosts (e.g. Render's free tier) block outbound SMTP.
 * The Chakam backend calls this endpoint over HTTPS instead of talking to SMTP itself.
 */
export async function POST(req: Request) {
  // --- shared-secret auth (prevents this from being an open relay) ---
  const secret = process.env.MAILER_SECRET;
  if (secret) {
    const provided = req.headers.get("x-mailer-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const { to, subject, body } = await req.json();

    if (!to || !subject || !body) {
      return NextResponse.json(
        { error: "Missing required fields (to, subject, body)" },
        { status: 400 }
      );
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return NextResponse.json(
        { error: "Mailer not configured: set EMAIL_USER and EMAIL_PASS" },
        { status: 500 }
      );
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      html: body,
    });

    return NextResponse.json({ message: "Email sent successfully!" });
  } catch (err) {
    console.error("Error sending email:", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}

/** GET /api/send — health check (no secret required). */
export async function GET() {
  return NextResponse.json({ status: "ok", service: "chakam-mailer" });
}
