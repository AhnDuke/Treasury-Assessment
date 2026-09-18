import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";

// Public Sans is USWDS's own typeface — the U.S. federal government's
// digital design system — chosen deliberately rather than a generic sans:
// it's built for exactly this audience (broad accessibility, government
// forms) and authentic to a federal compliance tool.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TTB Label Verification",
  description: "Prototype tool for verifying alcohol beverage labels against submitted application data.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
