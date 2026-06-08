# Chakam Mailer

A tiny **API-only** Next.js service that sends email via Gmail (nodemailer).

It exists because some hosts (e.g. **Render's free tier**) block outbound SMTP, so the Chakam
backend can't send mail directly. The backend instead calls this service over HTTPS, and this
service — deployed somewhere that allows SMTP (e.g. **Vercel**) — does the actual sending.

## Endpoint

```
POST /api/send
Headers: { "Content-Type": "application/json", "x-mailer-secret": "<MAILER_SECRET>" }
Body:    { "to": "user@example.com", "subject": "Hi", "body": "<b>HTML</b> body" }
```
- `GET /api/send` → `{ "status": "ok" }` (health check, no secret needed).
- Returns `401` if the secret is wrong, `400` if fields are missing, `500` on send failure.

## Env vars

| Var | Required | Notes |
|---|---|---|
| `EMAIL_USER` | ✅ | Gmail address that sends the mail |
| `EMAIL_PASS` | ✅ | Gmail **App Password** (16 chars), not your login password |
| `MAILER_SECRET` | ✅ (recommended) | Shared secret; the backend must send it in `x-mailer-secret` |
| `EMAIL_FROM` | optional | "From" header; defaults to `EMAIL_USER` |

> Gmail App Password: enable 2-Step Verification on the Google account, then
> Google Account → Security → App passwords → generate one for "Mail".

## Run locally

```bash
cd mailer
npm install
cp .env.example .env.local   # fill in real values
npm run dev                  # http://localhost:3000
# test:
curl -X POST http://localhost:3000/api/send \
  -H 'Content-Type: application/json' -H 'x-mailer-secret: <your secret>' \
  -d '{"to":"you@example.com","subject":"test","body":"<b>hi</b>"}'
```

## Deploy (Vercel)

1. New Vercel project → import the Chakam repo → set **Root Directory = `mailer`**.
2. Add env vars `EMAIL_USER`, `EMAIL_PASS`, `MAILER_SECRET` (and optional `EMAIL_FROM`).
3. Deploy. Your endpoint is `https://<project>.vercel.app/api/send`.
4. On the Chakam backend set `MAILER_URL` to that URL and `MAILER_SECRET` to the same secret.

See `../EMAIL_SETUP.md` for the full backend wiring.
