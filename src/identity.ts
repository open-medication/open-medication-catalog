import { v5 as uuidv5 } from "uuid";
import { type AuthorityKey, type EntityId } from "./branded.js";

/**
 * Project UUIDv5 namespace: UUIDv5(DNS, "openmedicationcatalog.org").
 * Stable across rebuilds and machines. Not a feed/source identifier.
 */
export const PROJECT_NAMESPACE = "6f62c357-cf30-5f1b-ad67-95ff1103b436";

export type EntityType =
  | "ProductGroup"
  | "MedicinalProduct"
  | "Package"
  | "Authorization"
  | "Organization"
  | "Ingredient"
  | "Substance"
  | "DeclarationRow";

/**
 * identityAuthority is the issuing authority (e.g. swissmedic), not the
 * acquisition feed. Replacing OGD XML with a future Swissmedic FHIR API
 * must not change IDs.
 */
export function canonicalId(opts: {
  jurisdiction: string;
  identityAuthority: string;
  entityType: EntityType;
  authorityKey: AuthorityKey | string;
}): EntityId {
  const name = [
    opts.jurisdiction,
    opts.identityAuthority,
    opts.entityType,
    opts.authorityKey,
  ].join("|");
  return uuidv5(name, PROJECT_NAMESPACE) as EntityId;
}
