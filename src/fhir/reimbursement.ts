import type { Reimbursement } from "../canonical/types.js";
import { FHIR_CANONICAL_BASE } from "../constants.js";

export function reimbursementDetailExtension(row: Reimbursement): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [{ url: "status", valueCoding: row.status }];
  if (row.validFrom) parts.push({ url: "validFrom", valueDate: row.validFrom });
  if (row.validTo) parts.push({ url: "validTo", valueDate: row.validTo });
  if (row.firstListingDate) parts.push({ url: "firstListingDate", valueDate: row.firstListingDate });
  if (row.expiryDate) parts.push({ url: "expiryDate", valueDate: row.expiryDate });
  if (row.costShare != null) parts.push({ url: "costShare", valueInteger: row.costShare });
  if (row.dossierNumber) parts.push({ url: "dossierNumber", valueString: row.dossierNumber });
  if (row.limitations) parts.push({ url: "limitations", valueString: row.limitations });
  if (row.gamme) parts.push({ url: "gamme", valueCoding: row.gamme });
  for (const p of row.prices ?? []) {
    const priceParts: Record<string, unknown>[] = [
      { url: "value", valueString: p.value },
      { url: "currency", valueString: p.currency },
    ];
    if (p.type) priceParts.push({ url: "type", valueCoding: p.type });
    if (p.changeType) priceParts.push({ url: "changeType", valueCoding: p.changeType });
    if (p.changeDate) priceParts.push({ url: "changeDate", valueDate: p.changeDate });
    parts.push({ url: "price", extension: priceParts });
  }
  return { url: `${FHIR_CANONICAL_BASE}/StructureDefinition/reimbursement`, extension: parts };
}
