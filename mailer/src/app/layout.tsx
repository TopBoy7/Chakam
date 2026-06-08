export const metadata = {
  title: "Chakam Mailer",
  description: "Email-sending API for Chakam",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
