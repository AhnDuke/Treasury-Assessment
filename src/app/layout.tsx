import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import "./globals.css";

// Public Sans is USWDS's own typeface - the U.S. federal government's
// digital design system - chosen deliberately rather than a generic sans:
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

// Runs before paint so an explicit stored theme choice applies immediately -
// without this, the page would flash the system-default theme first, then
// snap to the stored one once React hydrates.
const themeInitScript = `
try {
  var stored = localStorage.getItem("ttb-theme");
  if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
} catch (e) {}
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
