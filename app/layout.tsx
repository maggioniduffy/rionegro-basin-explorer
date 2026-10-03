import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_STORAGE_KEY } from "@/lib/store";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Dark is the default. A saved light choice is applied before first paint, so the page
// never flashes dark; ThemeToggle adopts it after hydration.
const themeScript = `try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  // The image comes from app/opengraph-image.tsx. Its absolute URL uses Vercel's
  // production domain (VERCEL_PROJECT_PRODUCTION_URL), so no metadataBase is set here.
  return {
    title: t("title"),
    description: t("description"),
    openGraph: {
      title: t("title"),
      description: t("description"),
      type: "website",
    },
    twitter: { card: "summary_large_image" },
  };
}

// The locale comes from a cookie (i18n/request.ts), so this layout renders per request.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The theme script may set data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
