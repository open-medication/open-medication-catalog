/** CHI Drug Formulary page. The human-drug-list workbook href lives on this page. */
export const SFDA_FORMULARY_PAGE = "https://www.chi.gov.sa/en/Rules/Pages/DamanDrugFormulary.aspx";

const TITLE = /<p\b[^>]*\bregulations-title\b[^>]*>([\s\S]*?)<\/p>/gi;
const HREF = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i;

function collapse(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeAttr(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

/**
 * Absolute URL of the workbook linked from the “SFDA Human Drug List” card.
 * Other xlsx links on the same page (formulary, active ingredient) are ignored.
 */
export function humanDrugListUrl(html: string, pageUrl: string): string {
  const found: string[] = [];
  for (const match of html.matchAll(TITLE)) {
    const title = collapse(match[1] ?? "");
    if (!/^SFDA Human Drug List$/i.test(title)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const after = html.slice(start);
    const nextTitle = after.search(/<p\b[^>]*\bregulations-title\b/i);
    const region = nextTitle === -1 ? after : after.slice(0, nextTitle);
    const href = region.match(HREF)?.[1];
    if (!href) throw new Error("SFDA Human Drug List card has no link");
    const url = new URL(decodeAttr(href), pageUrl);
    if (url.protocol !== "https:") {
      throw new Error(`SFDA Human Drug List link is not https: ${url.href}`);
    }
    const host = url.hostname.toLowerCase();
    if (host !== "www.chi.gov.sa" && host !== "chi.gov.sa") {
      throw new Error(`SFDA Human Drug List link is not on chi.gov.sa: ${url.href}`);
    }
    if (!url.pathname.toLowerCase().endsWith(".xlsx")) {
      throw new Error(`SFDA Human Drug List link is not an xlsx: ${url.href}`);
    }
    found.push(url.href);
  }
  if (found.length === 0) throw new Error("CHI formulary page has no SFDA Human Drug List card");
  if (found.length > 1) throw new Error("CHI formulary page has more than one SFDA Human Drug List card");
  return found[0]!;
}
