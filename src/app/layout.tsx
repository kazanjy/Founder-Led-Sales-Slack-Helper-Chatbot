import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PostHogProvider } from "@/components/PostHogProvider";
import CmdKPalette from "@/components/CmdKPalette";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mikeybot.io";

export const metadata: Metadata = {
  title: {
    default: "Mikey - Your AI-Powered Founder-Led Sales Platform",
    template: "%s - Mikey",
  },
  description: "Build your complete sales playbook automatically — narrative, ICP, discovery questions, sales decks, outreach sequences, and more.",
  openGraph: {
    title: "Mikey - Your AI-Powered Founder-Led Sales Platform",
    description: "Build your complete sales playbook automatically — narrative, ICP, discovery questions, sales decks, outreach sequences, and more.",
    type: "website",
    url: appUrl,
    siteName: "Mikey",
    images: [
      {
        url: `${appUrl}/mikey-avatar.png`,
        width: 512,
        height: 512,
        type: "image/png",
        alt: "Mikey",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Mikey - Your AI-Powered Founder-Led Sales Platform",
    description: "Build your complete sales playbook automatically — narrative, ICP, discovery questions, sales decks, outreach sequences, and more.",
    images: [`${appUrl}/mikey-avatar.png`],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* No-flash theme script. Runs synchronously before paint so
            the .dark class is on <html> when the first frame lands —
            no light → dark snap on reload. Falls back to OS preference
            when the user hasn't picked an explicit theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mikey-theme');var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var dark=t==='dark'||((!t||t==='system')&&prefersDark);document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PostHogProvider>{children}</PostHogProvider>
        {/* Global Cmd/Ctrl+K palette. Mounted at the root so the
            shortcut works from every page; lazy-loads /api/deals on
            first open and silently no-ops for unauthenticated
            visitors. */}
        <CmdKPalette />
      </body>
    </html>
  );
}
