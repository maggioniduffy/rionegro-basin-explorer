import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import Link from "next/link";
import { isLocale, LOCALES } from "@/i18n/config";
import { messagesFor } from "@/i18n/messages";
import { MAP_PATH } from "@/lib/url-state";
import { REGION_IDS, regionPath, type RegionId } from "@/regions";
import footerArt from "../../public/landing/footer-art.png";
import { Logomark } from "../Icon";
import { Wordmark } from "./Wordmark";

const HEADING =
  "text-text mb-1.5 font-mono text-xs font-medium tracking-[.16em] uppercase";
const LINK = "text-secondary hover:text-text inline-flex min-h-10 items-center";

/**
 * The footer: wordmark and credit, three link columns, and the owner's river-valley art
 * (decorative, art only: public/landing/footer-art.png has no text) faded into the page
 * (.footer-art in globals.css). `path` is the page's path inside the region. `overlap` (the
 * landing) pulls the footer up under the data note, which overlaps it: the top padding then
 * clears the note. Without a `region` (the hub) the Explore and Data columns list every served
 * region, named by its own messages, the name is the hub's title, and the language links point
 * at the hub.
 */
export async function SiteFooter({
  region,
  path,
  overlap = false,
}: {
  region?: RegionId;
  path: string;
  overlap?: boolean;
}) {
  const t = await getTranslations("landing");
  const ls = await getTranslations("localeSwitcher");
  const hub = await getTranslations("hub.metadata");
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const regions = REGION_IDS.map((id) => ({
    id,
    title: messagesFor(id, locale).metadata.title,
  }));
  return (
    <footer
      className={`text-footer relative overflow-hidden text-[15px] ${
        overlap ? "-mt-[max(80px,7vw)]" : ""
      }`}
    >
      <div
        className={`relative z-2 mx-auto flex max-w-[1200px] flex-wrap justify-between gap-x-12 gap-y-9 px-[clamp(20px,5vw,64px)] pb-[max(140px,15vw)] ${
          overlap
            ? "pt-[calc(max(80px,7vw)_+_clamp(48px,6vw,80px))]"
            : "pt-[clamp(48px,6vw,80px)]"
        }`}
      >
        <div className="flex max-w-[340px] flex-col gap-3.5">
          <span className="text-text">
            {region ? (
              <Wordmark large />
            ) : (
              <span className="flex items-center gap-2.5">
                <Logomark width={34} className="shrink-0" />
                <span className="font-sans text-[17px] font-medium tracking-[-0.01em]">
                  {hub("title")}
                </span>
              </span>
            )}
          </span>
          <span className="leading-[1.55]">{t("credit")}</span>
        </div>
        <div className="flex flex-wrap gap-x-[clamp(36px,6vw,96px)] gap-y-7">
          <div className="flex flex-col gap-1">
            <div className={HEADING}>{t("fExplore")}</div>
            {region ? (
              <>
                <Link
                  href={regionPath(region, MAP_PATH)}
                  className="text-accent hover:text-text inline-flex min-h-10 items-center font-semibold"
                >
                  {t("open")} →
                </Link>
                <Link href="/" className={LINK}>
                  {t("hub")}
                </Link>
              </>
            ) : (
              regions.map((r) => (
                <Link key={r.id} href={regionPath(r.id)} className={LINK}>
                  {r.title}
                </Link>
              ))
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className={HEADING}>{t("fData")}</div>
            {region ? (
              <Link href={regionPath(region, "/attributions")} className={LINK}>
                {t("attr")}
              </Link>
            ) : (
              regions.map((r) => (
                <Link
                  key={r.id}
                  href={regionPath(r.id, "/attributions")}
                  className={LINK}
                >
                  {t("attr")} · {r.title}
                </Link>
              ))
            )}
          </div>
          <div className="flex flex-col gap-1">
            <div className={HEADING}>{t("fLang")}</div>
            {/* Plain anchors: see LocaleLinks. */}
            {LOCALES.map((l) => (
              <a
                key={l}
                href={`/${l}${region ? regionPath(region, path) : ""}`}
                lang={l}
                hrefLang={l}
                className={LINK}
              >
                {ls("locale", { locale: l })}
              </a>
            ))}
          </div>
        </div>
      </div>
      {/* 2029×547 source: the band is as tall as the image at full width (27vw), at least
          200px, so it is never upscaled much. */}
      <div
        aria-hidden
        className="footer-art pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[max(200px,27vw)]"
      >
        <Image
          src={footerArt}
          alt=""
          fill
          sizes="100vw"
          className="footer-art-img object-cover object-[50%_100%]"
        />
      </div>
    </footer>
  );
}
