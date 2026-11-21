import type { Metadata } from "next";
import { Geist, Google_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// The product UI.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
// Big headings.
const googleSans = Google_Sans({ variable: "--font-google-sans", subsets: ["latin"], weight: ["400", "500", "700"] });
// Code and numbers.
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Morning Telos",
  description: "Your AI team for running a small business.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${googleSans.variable} ${jetbrains.variable} h-full`}>
      <body className="min-h-full font-sans text-[14px] leading-normal">{children}</body>
    </html>
  );
}
