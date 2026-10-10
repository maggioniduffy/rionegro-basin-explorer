import type { routing } from "@/i18n/routing";
import type { Messages } from "@/i18n/messages";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: Messages;
  }
}

declare global {
  interface Window {
    /** Test hooks, set only when built with NEXT_PUBLIC_E2E=1 (MapView). */
    __map?: import("maplibre-gl").Map;
    __mapHover?: (e: import("maplibre-gl").MapMouseEvent) => void;
  }
}
