import fs from "node:fs";
import YAML from "yaml";
import type { CodedValue } from "../../canonical/types.js";
import { repoPath } from "../../paths.js";

export const EDQM_ROUTE_SYSTEM = "http://standardterms.edqm.eu";

interface RouteEdqmFile {
  edqmSystem?: string;
  map: Record<string, { code: string; display: string }>;
}

let cached: RouteEdqmFile | undefined;

export function loadRouteEdqmMap(): RouteEdqmFile {
  if (!cached) {
    cached = YAML.parse(
      fs.readFileSync(repoPath("adapters/ch/swissmedic/route-edqm.yaml"), "utf8"),
    ) as RouteEdqmFile;
  }
  return cached;
}

/** EDQM ROA coding for a Swissmedic ROUTE_ADMIN code, if the English labels matched. */
export function edqmRouteCoding(swissmedicCode: string): CodedValue | undefined {
  const hit = loadRouteEdqmMap().map[swissmedicCode];
  if (!hit) return undefined;
  return {
    system: loadRouteEdqmMap().edqmSystem ?? EDQM_ROUTE_SYSTEM,
    code: hit.code,
    display: hit.display,
  };
}
