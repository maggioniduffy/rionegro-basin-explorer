import { Analytics } from "@vercel/analytics/next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import {
  Instrument_Sans,
  Instrument_Serif,
  JetBrains_Mono,
} from "next/font/google";
import { cookies } from "next/headers";
import {
  isTheme,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
} from "@/lib/theme-tokens";
import "./globals.css";

// UI and body.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Eyebrows, numbers and attribution lines.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Headlines and panel titles (the display face).
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

// Runs only when no theme cookie is set: follow the system preference (dark is the
// default), or a light choice saved in localStorage before the theme moved to a cookie.
// Either way it writes the cookie, so later requests render the right theme on the server.
const themeScript = `try{var d=document.documentElement,t=null;try{t=localStorage.getItem("theme")}catch(e){}if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";if(t==="light")d.dataset.theme="light";document.cookie="${THEME_COOKIE}="+t+"; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax"}catch(e){}`;

// The locale comes from a cookie (i18n/request.ts), so this layout renders per request.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const savedTheme = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = isTheme(savedTheme) ? savedTheme : null;

  return (
    <html
      lang={locale}
      className={`${instrumentSans.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      data-theme={theme === "light" ? "light" : undefined}
      // Without a cookie, the theme script may set data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        {theme === null && (
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        )}
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
