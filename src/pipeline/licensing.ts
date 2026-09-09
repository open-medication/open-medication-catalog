import type { SourceSnapshot } from "../canonical/types.js";
import { loadSourceDescriptorById, type SourceDescriptor } from "../adapters/descriptor.js";

export const LICENCE_DISCLAIMER = `The commercialUse, redistribution, and attributionRequired flags in this directory and in manifest.json are indicators of our interpretation of the linked upstream terms at the dated review. They are not a licence grant and not legal advice. They may be misclassified.

We are not liable for misinterpreting upstream licences. We are not liable for fitness for a specific purpose, or for legal compatibility or suitability for integration into any downstream product. You must cross-check the linked upstream terms before use.

We do not control how those terms are worded or when they change. Official builds checksum the terms page and halt redistribution if the live page no longer matches the snapshot recorded here. That check is a snapshot, not a guarantee the live page stays still.`;

export interface SourceLicensing {
  termsUrl: string;
  datasetUrl?: string;
  fragment?: string;
  commercialUse: SourceDescriptor["commercialUse"];
  redistribution: SourceDescriptor["redistribution"];
  attributionRequired: boolean;
  reviewedAt: string;
  checksum?: string;
}

export function sourceLicensing(sourceId: string): SourceLicensing {
  const desc = loadSourceDescriptorById(sourceId);
  return {
    termsUrl: desc.terms.url,
    datasetUrl: desc.terms.datasetUrl,
    fragment: desc.terms.fragment,
    commercialUse: desc.commercialUse,
    redistribution: desc.redistribution,
    attributionRequired: desc.attributionRequired,
    reviewedAt: desc.terms.reviewedAt,
    checksum: desc.terms.checksum,
  };
}

function descriptorForSnapshot(snapshot: SourceSnapshot): SourceDescriptor | undefined {
  try {
    return loadSourceDescriptorById(snapshot.sourceId);
  } catch {
    return undefined;
  }
}

export function licensingReadme(): string {
  return `# Licensing

The generator that produced this archive is Apache-2.0. The medicinal-product data is not. Each source keeps its upstream licence.

## Disclaimer

${LICENCE_DISCLAIMER}

## How to verify

1. Open each \`termsUrl\` listed in \`SOURCES.md\` and in \`manifest.json\`.
2. Compare the live page to the recorded \`checksum\` (SHA-256 of the normalized HTML, or of the named HTML fragment when \`fragment\` is set).
3. Treat the flags as our reading only.

See \`SOURCES.md\` for per-source flags, dates, and notes.
`;
}

export function licensingSourcesMarkdown(snapshots: SourceSnapshot[], attachedRaw: Set<string>): string {
  const blocks = snapshots.map((s) => {
    const desc = descriptorForSnapshot(s);
    const rawAttached = attachedRaw.has(s.sourceId);
    const redistributeRaw = desc?.releasePolicy?.redistributeRaw;
    const termsUrl = desc?.terms.url ?? "(no terms.url recorded)";
    const lines = [
      `## ${s.sourceId}`,
      "",
      `- Authority: ${desc?.authority ?? s.identityAuthority}`,
      `- Identity authority: ${s.identityAuthority}`,
      `- Effective: ${s.sourceEffectiveDate ?? "unknown"}`,
      `- Source SHA-256: ${s.sha256}`,
      `- Terms: ${termsUrl}`,
    ];
    if (desc?.terms.datasetUrl) lines.push(`- Dataset: ${desc.terms.datasetUrl}`);
    if (desc?.terms.fragment) lines.push(`- Fragment: \`#${desc.terms.fragment}\``);
    lines.push(`- commercialUse: ${desc?.commercialUse ?? "unknown"}`);
    lines.push(`- redistribution: ${desc?.redistribution ?? "unknown"}`);
    lines.push(`- attributionRequired: ${desc ? String(desc.attributionRequired) : "unknown"}`);
    lines.push(`- reviewedAt: ${desc?.terms.reviewedAt ?? s.termsReviewedAt ?? "unknown"}`);
    if (desc?.terms.checksum ?? s.termsChecksum) {
      lines.push(`- checksum: ${desc?.terms.checksum ?? s.termsChecksum}`);
    }
    lines.push(`- Raw source bytes attached: ${rawAttached ? "yes" : "no"}`);
    if (redistributeRaw === false) lines.push("- Raw ZIP is not redistributed (\`releasePolicy.redistributeRaw: false\`).");
    if (desc?.terms.notes) {
      lines.push("");
      lines.push(desc.terms.notes);
    }
    return `${lines.join("\n")}\n`;
  });
  return `# Sources

Flags below are our interpretation of upstream terms. They are not a licence. See README.md in this directory.

${blocks.join("\n")}`;
}

export function licensingTexts(
  snapshots: SourceSnapshot[],
  attachedRaw: Iterable<string> = [],
): { name: string; text: string }[] {
  const attached = new Set(attachedRaw);
  return [
    { name: "README.md", text: licensingReadme() },
    { name: "SOURCES.md", text: licensingSourcesMarkdown(snapshots, attached) },
  ];
}
