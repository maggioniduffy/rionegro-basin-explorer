import { useTranslations } from "next-intl";
import { Controls } from "@/components/Controls";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { BasinMap } from "@/components/map/BasinMap";

export default function HomePage() {
  const t = useTranslations("home");

  return (
    <main className="relative h-dvh overflow-hidden">
      <BasinMap />
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <h1 className="pointer-events-auto rounded-md bg-(--panel) px-3 py-1.5 text-base font-semibold tracking-tight shadow backdrop-blur">
          {t("title")}
        </h1>
        <div className="pointer-events-auto rounded-md bg-(--panel) px-2 py-1 shadow backdrop-blur">
          <LocaleSwitcher />
        </div>
      </header>
      <Controls />
    </main>
  );
}
