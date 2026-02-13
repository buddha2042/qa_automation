import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { ToastProvider } from "@/lib/toast";
import { QaProvider } from "@/context/QaContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-slate-50 text-slate-900`}
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
