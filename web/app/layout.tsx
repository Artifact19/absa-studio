import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Target-Oriented ABSA Studio | Public Sentiment Intelligence",
  description:
    "See what people really think. Search any phone, game, brand, or celebrity to analyze true public sentiment.",
  icons: {
    icon: "/cat-icon.png",
    apple: "/cat-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans bg-[#edf1f7] text-slate-900 selection:bg-sky-200 selection:text-slate-900">
        {children}
      </body>
    </html>
  );
}
