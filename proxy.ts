import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

// Skip API routes, Next internals and any path with a file extension
// (static assets, including .pmtiles, whose Range requests must not be touched).
export const config = {
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
