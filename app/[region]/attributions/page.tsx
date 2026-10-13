import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { messagesFor } from "@/i18n/messages";
import {
  SOFTWARE,
  sourcesFor,
  type Source,
  type SourceId,
} from "@/lib/attributions";
import { DEFAULT_REGION, isRegionId } from "@/regions";

/** The panel caveats (messages panel.caveat.*), listed here in one place (rule 4). */
const CAVEATS = [
  "discharge",
  "nonPerennial",
  "flooded",
  "population",
  "regulation",
] as const;

/** Sources whose license terms need a sentence of explanation. */
const TERMS = {
  ign: "ign.terms",
  aprhi: "aprhi.terms",
  osm: "osm.terms",
  eox: "eox.terms",
} as const satisfies Partial<Record<SourceId, string>>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("attributions");
  return { title: t("metaTitle"), description: t("intro") };
}

function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      className="underline decoration-(--border) underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-6 flex-col gap-4"
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted text-xs font-medium tracking-wide uppercase">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

async function SourceCard({ source }: { source: Source }) {
  const t = await getTranslations("attributions.sources");
  return (
    <article
      aria-labelledby={`source-${source.id}`}
      className="bg-surface border-line-card flex flex-col gap-3 rounded-[14px] border p-4"
    >
      <h3 id={`source-${source.id}`} className="font-semibold">
        <ExternalLink href={source.url}>{source.name}</ExternalLink>
      </h3>
      <dl className="flex flex-col gap-3 text-sm">
        <Field label={t("usedFor")}>
          {t(source.usedForKey ?? `${source.id}.usedFor`)}
        </Field>
        <Field label={t("license")}>
          <ExternalLink href={source.license.url}>
            {source.license.name}
          </ExternalLink>
          {source.id in TERMS && (
            <p className="text-muted mt-1">
              {t(TERMS[source.id as keyof typeof TERMS])}
            </p>
          )}
        </Field>
        {source.credit && (
          <Field label={t("credit")}>
            <q className="font-medium">{source.credit}</q>
          </Field>
        )}
        {source.citations.length > 0 && (
          <Field label={t("citation")}>
            <ul className="flex flex-col gap-1.5">
              {source.citations.map((c) => (
                <li key={c.text}>
                  {c.text}
                  {c.url && (
                    <>
                      {" "}
                      <ExternalLink href={c.url}>{c.url}</ExternalLink>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </Field>
        )}
        {source.notice && (
          <Field label={t("notice")}>
            {/* The license asks for this text as written, so it stays in English. */}
            <blockquote
              lang="en"
              className="text-muted border-l-2 border-(--border) pl-3"
            >
              {source.notice}
            </blockquote>
          </Field>
        )}
      </dl>
    </article>
  );
}

export default async function AttributionsPage({
  params,
}: PageProps<"/[region]/attributions">) {
  const { region: raw } = await params;
  const region = isRegionId(raw) ? raw : DEFAULT_REGION;
  // The product name in the HydroSHEDS notice is the region's English title (a proper noun).
  const sources = sourcesFor(region, messagesFor(region, "en").metadata.title);
  const t = await getTranslations("attributions");
  const caveat = await getTranslations("panel.caveat");

  return (
    <div className="bg-bg text-text flex min-h-full w-full flex-col">
      <SiteHeader path="/attributions" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-8 sm:py-12">
        <header className="flex flex-col gap-4">
          <Link
            href="/map"
            className="text-muted hover:text-foreground flex w-fit items-center gap-1.5 text-sm"
          >
            <Icon name="chevron" size={16} className="rotate-180" />
            {t("back")}
          </Link>
          <h1 className="text-[clamp(28px,4vw,44px)] font-medium tracking-[-0.025em]">
            {t("title")}
          </h1>
          <p>{t("intro")}</p>
          <p className="text-muted text-sm">{t("independent")}</p>
        </header>

        <Section id="modeled" title={t("modeled.title")}>
          <p>{t("modeled.intro")}</p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            {CAVEATS.map((c) => (
              <li key={c}>{caveat(c)}</li>
            ))}
          </ul>
          <p>{t("modeled.regulated")}</p>
          <p>{t("modeled.derived")}</p>
        </Section>

        <Section id="sources" title={t("sources.title")}>
          <p>{t("sources.intro")}</p>
          <div className="flex flex-col gap-4">
            {sources.map((s) => (
              <SourceCard key={s.id} source={s} />
            ))}
          </div>
        </Section>

        <Section id="software" title={t("software.title")}>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {SOFTWARE.map((s) => (
              <li key={s.name}>
                <ExternalLink href={s.url}>{s.name}</ExternalLink> ({s.license})
              </li>
            ))}
          </ul>
        </Section>
      </main>
      <SiteFooter path="/attributions" />
    </div>
  );
}
