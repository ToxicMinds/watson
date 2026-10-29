import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-static"; // written once at build: the site is static files

// ponytail: the front page only; it links every practitioner's page. List those here when there
// are enough that a crawler should not have to find them by following links.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/` }, { url: `${SITE_URL}/privacy/` }];
}
