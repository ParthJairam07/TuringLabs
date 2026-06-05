import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live AI Mentor",
  description: "A voice-based AI mentor built from public YouTube videos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
