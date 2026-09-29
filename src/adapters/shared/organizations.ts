import type { Organization, SourceRecordRef, SourceSnapshot } from "../../canonical/types.js";
import { canonicalId } from "../../identity.js";

export interface OrganizationUpserterContext {
  jurisdiction: string;
  identityAuthority: string;
  organizationSystem: string;
  snapshot: SourceSnapshot;
  sourceRef: (snapshot: SourceSnapshot, recordKey: string) => SourceRecordRef;
  mapKey?: (name: string, role: Organization["role"]) => string;
  authorityKey?: (name: string, role: Organization["role"]) => string;
  recordKey?: (name: string, role: Organization["role"]) => string;
}

export function createOrganizationUpserter(ctx: OrganizationUpserterContext) {
  return function upsertOrg(
    orgByKey: Map<string, Organization>,
    organizations: Organization[],
    name: string | undefined,
    role: Organization["role"],
  ): Organization | undefined {
    const trimmed = name?.trim() ?? "";
    if (!trimmed) return undefined;
    const mapKey = ctx.mapKey?.(trimmed, role) ?? `${role}|${trimmed}`;
    const existing = orgByKey.get(mapKey);
    if (existing) return existing;
    const authorityKey = ctx.authorityKey?.(trimmed, role) ?? mapKey;
    const recordKey = ctx.recordKey?.(trimmed, role) ?? mapKey;
    const org: Organization = {
      id: canonicalId({
        jurisdiction: ctx.jurisdiction,
        identityAuthority: ctx.identityAuthority,
        entityType: "Organization",
        authorityKey,
      }),
      jurisdiction: ctx.jurisdiction,
      identityAuthority: ctx.identityAuthority,
      authorityKey,
      name: trimmed,
      role,
      identifiers: [{ system: ctx.organizationSystem, value: trimmed }],
      sourceRecords: [ctx.sourceRef(ctx.snapshot, recordKey)],
    };
    orgByKey.set(mapKey, org);
    organizations.push(org);
    return org;
  };
}
