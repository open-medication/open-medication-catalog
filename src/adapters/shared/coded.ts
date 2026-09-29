import type { CodedValue } from "../../canonical/types.js";
import { fhirCode } from "../../fhir/serialize.js";

export interface SourceCodedOptions {
  blankSentinels?: string[];
  rejectDisplay?: (display: string) => void;
}

/** Map source text to a canonical coded value, trimming blanks and optional sentinels. */
export function sourceCodedValue(
  system: string,
  value: string | undefined,
  options: SourceCodedOptions = {},
): CodedValue | undefined {
  const display = value?.trim();
  if (!display) return undefined;
  if (options.blankSentinels?.includes(display)) return undefined;
  options.rejectDisplay?.(display);
  return { system, code: fhirCode(display), display };
}
