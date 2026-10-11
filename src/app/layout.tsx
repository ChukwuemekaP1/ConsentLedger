import type { Metadata } from "next";
import "../ui/globals.css";

export const metadata: Metadata = {
  title: "ConsentLedger",
  description: "Agents propose. Humans sign. PayPal settles. Everything is provable.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
