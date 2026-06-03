import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  // Class-based so the user can override the OS preference via the
  // theme toggle. Default is still 'system' (no class set → no dark
  // styles applied), so existing users only flip dark via OS until
  // they pick a preference. The no-flash script in app/layout.tsx
  // applies the .dark class on <html> before paint.
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [typography],
} satisfies Config;
