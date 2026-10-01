import { useTranslations } from "next-intl";
import { Controls } from "@/components/Controls";
import { Logomark } from "@/components/Icon";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { BasinMap } from "@/components/map/BasinMap";
import { InfoPanel } from "@/components/panel/InfoPanel";
import { SearchBox } from "@/components/SearchBox";
import { UrlSync } from "@/components/UrlSync";

export default function HomePage() {
  const t = useTranslations("home");

  return (
    <main className="relative h-dvh overflow-hidden">
      <BasinMap />
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-3">
          <h1 className="pointer-events-auto flex items-center gap-2 rounded-md bg-(--panel) px-3 py-1.5 text-base font-semibold tracking-tight shadow backdrop-blur">
            <Logomark width={28} className="shrink-0" />
            {t("title")}
          </h1>
          <div className="pointer-events-auto w-full max-w-64">
            <SearchBox />
          </div>
        </div>
        <div className="pointer-events-auto rounded-md bg-(--panel) px-2 py-1 shadow backdrop-blur">
          <LocaleSwitcher />
        </div>
      </header>
      <Controls />
      <InfoPanel />
      <UrlSync />
    </main>
  );
}
