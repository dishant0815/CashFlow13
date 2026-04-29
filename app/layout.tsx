import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";

export const metadata: Metadata = {
  title: "CashFlow13 — 13-week cash forecast for small businesses",
  description:
    "Connect your bank, see the next 13 weeks of cash, and get plain-English explanations for any week your balance dips.",
  openGraph: {
    title: "CashFlow13",
    description:
      "13-week rolling cash forecast with plain-English explanations.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
