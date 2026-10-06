import { redirect } from "next/navigation";
import { MAP_PATH } from "@/lib/url-state";

// Replaced by the landing page in the next commit.
export default function LandingPage() {
  redirect(MAP_PATH);
}
