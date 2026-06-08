export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Chakam Mailer</h1>
      <p>
        Email-sending API. Send mail with <code>POST /api/send</code> (JSON:
        <code> {`{ to, subject, body }`}</code>, header <code>x-mailer-secret</code>).
      </p>
      <p>Health: <code>GET /api/send</code></p>
    </main>
  );
}
