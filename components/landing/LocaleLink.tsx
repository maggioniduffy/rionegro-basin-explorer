"use client";

import type { AnchorHTMLAttributes } from "react";

/**
 * A plain anchor to /<locale>/... that appends the current query string at click time, so a
 * page whose state lives in the URL (the effluent analysis, ?ef=) survives the language switch.
 * Not <Link>: a prefetch would set the locale cookie without a click (see LocaleLinks).
 */
export function LocaleLink({
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        rest.onClick?.(e);
        e.currentTarget.href = `${href}${window.location.search}`;
      }}
    />
  );
}
