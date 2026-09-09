import { isOfficialArtifactId } from "../artifacts.js";
import { swissmedicArchiveCandidates } from "../adapters/ch/swissmedic.js";
import { httpExists } from "../security.js";
import { calendarForDate, monthsToProbe, parseDataMonth } from "./dates.js";
import { catalogFromReleaseTags, fetchGithubReleaseTags } from "./packager.js";

export const SWISSMEDIC_DISCOVERY_LOOKBACK_MONTHS = 12;

export type NextMonthReason = "newer" | "up-to-date" | "already-shipped" | "forced";

export interface NextMonthResult {
  skip: boolean;
  reason: NextMonthReason;
  artifactId: string;
  month?: string;
  tag?: string;
  lastShipped?: string;
  probed: string[];
}

export async function swissmedicDataMonthAvailable(dataMonth: string): Promise<boolean> {
  const { archiveMonth } = parseDataMonth(dataMonth);
  for (const candidate of swissmedicArchiveCandidates(archiveMonth)) {
    if (await httpExists(candidate.url)) return true;
  }
  return false;
}

export function lastShippedMonth(tags: string[], artifactId: string): string | undefined {
  return catalogFromReleaseTags(tags).artifacts[artifactId]?.latest;
}

export async function resolveNextDataMonth(opts: {
  artifactId: string;
  tags: string[];
  now?: Date;
  forcedMonth?: string;
  archiveAvailable?: (dataMonth: string) => Promise<boolean>;
}): Promise<NextMonthResult> {
  if (!isOfficialArtifactId(opts.artifactId)) {
    throw new Error(`Unknown artifact '${opts.artifactId}'`);
  }
  const lastShipped = lastShippedMonth(opts.tags, opts.artifactId);
  const available = opts.archiveAvailable ?? swissmedicDataMonthAvailable;

  if (opts.forcedMonth) {
    parseDataMonth(opts.forcedMonth);
    const tag = `${opts.artifactId}-${opts.forcedMonth}`;
    if (opts.tags.includes(tag)) {
      return {
        skip: true,
        reason: "already-shipped",
        artifactId: opts.artifactId,
        month: opts.forcedMonth,
        tag,
        lastShipped,
        probed: [],
      };
    }
    return {
      skip: false,
      reason: "forced",
      artifactId: opts.artifactId,
      month: opts.forcedMonth,
      tag,
      lastShipped,
      probed: [],
    };
  }

  const current = calendarForDate(opts.now).dataMonth;
  const probed = monthsToProbe({
    lastShipped,
    current,
    lookbackMonths: SWISSMEDIC_DISCOVERY_LOOKBACK_MONTHS,
  }).reverse();

  for (const month of probed) {
    if (await available(month)) {
      return {
        skip: false,
        reason: "newer",
        artifactId: opts.artifactId,
        month,
        tag: `${opts.artifactId}-${month}`,
        lastShipped,
        probed,
      };
    }
  }

  return {
    skip: true,
    reason: "up-to-date",
    artifactId: opts.artifactId,
    lastShipped,
    probed,
  };
}

export async function discoverNextDataMonth(opts: {
  artifactId: string;
  forcedMonth?: string;
  now?: Date;
}): Promise<NextMonthResult> {
  return resolveNextDataMonth({
    artifactId: opts.artifactId,
    tags: await fetchGithubReleaseTags(),
    forcedMonth: opts.forcedMonth,
    now: opts.now,
  });
}

export function formatNextMonthSummary(result: NextMonthResult): string {
  const last = result.lastShipped ?? "(none)";
  if (result.skip && result.reason === "already-shipped") {
    return `already-shipped artifact=${result.artifactId} month=${result.month} last=${last}`;
  }
  if (result.skip) {
    const range = result.probed.length ? ` probed=${result.probed[result.probed.length - 1]}…${result.probed[0]}` : "";
    return `up-to-date artifact=${result.artifactId} last=${last}${range}`;
  }
  return `next-month ${result.month} artifact=${result.artifactId} last=${last} reason=${result.reason}`;
}

export function githubOutputLines(result: NextMonthResult): string {
  return [
    `skip=${result.skip}`,
    `month=${result.month ?? ""}`,
    `tag=${result.tag ?? ""}`,
    `last_shipped=${result.lastShipped ?? ""}`,
    `reason=${result.reason}`,
  ].join("\n");
}
