import { useTranslations } from "next-intl";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

export default function HomePage() {
  const t = useTranslations("home");

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex justify-end p-4">
        <LocaleSwitcher />
      </header>
      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted max-w-md">{t("subtitle")}</p>
      </section>
    </main>
  );
}
