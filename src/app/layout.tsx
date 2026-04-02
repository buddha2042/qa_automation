import type { Metadata } from "next";
import "./globals.css";

import { ToastProvider } from "@/lib/toast";
import { QaProvider } from "@/context/QaContext";

export const metadata: Metadata = {
  title: "Data Integrity Studio",
  description: "Advanced Sisense QA Automation by Buddha",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased bg-slate-50 text-slate-900"
      >
        {/* Global Notifications */}
        <ToastProvider>
          {/* Global QA / Regression Context */}
          <QaProvider>
            {children}
          </QaProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
