import { FHIR_CANONICAL_BASE } from "../constants.js";
import type { Catalogue, Package } from "../canonical/types.js";
import { stableJson, jsonLine } from "./serialize.js";

export const R4_PROFILE = `${FHIR_CANONICAL_BASE}/StructureDefinition/OpenMedicationPackage`;

/** Catalogue-record lifecycle only. Not marketing or reimbursement. */
export function medicationStatus(pkg: Package): "active" | "inactive" | undefined {
  const code = pkg.regulatoryStatus.code;
  if (code === "D" || code === "BA" || code === "U") return "inactive";
  if (code === "Z" || code === "B" || code === "S" || code === "N" || code === "A") return "active";
  return undefined;
}

export function exportR4(catalogue: Catalogue, releaseLabel: string): Record<string, string> {
  const medications: string[] = [];
  const orgs: string[] = [];
  for (const org of catalogue.organizations) {
    orgs.push(
      jsonLine({
        resourceType: "Organization",
        id: org.id,
        meta: {
          source: metaSource(catalogue, org.identityAuthority),
        },
        identifier: org.identifiers,
        name: org.name,
        extension: [
          ext("identity-authority", org.identityAuthority),
          ext("jurisdiction", org.jurisdiction),
          ext("omc-release", releaseLabel),
        ],
      }),
    );
  }
  for (const pkg of catalogue.packages) {
    const mp = catalogue.medicinalProducts.find((m) => m.id === pkg.medicinalProductId);
    const status = medicationStatus(pkg);
    const resource: Record<string, unknown> = {
      resourceType: "Medication",
      id: pkg.id,
      meta: {
        profile: [R4_PROFILE],
        source: metaSource(catalogue, pkg.identityAuthority),
      },
      identifier: [
        { system: `${FHIR_CANONICAL_BASE}/sid/resource-id`, value: pkg.id },
        ...pkg.identifiers,
      ],
      code: {
        text: pkg.description,
        coding: pkg.gtin
          ? [{ system: "https://www.gs1.org/gtin", code: pkg.gtin }]
          : mp
            ? [{ system: `${FHIR_CANONICAL_BASE}/sid/ch/swissmedic/sequence`, code: mp.authorityKey }]
            : undefined,
      },
      form: mp?.doseForm
        ? { coding: [mp.doseForm], text: mp.doseForm.display ?? mp.doseForm.code }
        : undefined,
      amount: pkg.quantity.structured
        ? {
            numerator: { value: Number(pkg.quantity.value), unit: pkg.quantity.unit?.display ?? pkg.quantity.unit?.code },
            denominator: { value: 1 },
          }
        : undefined,
      ingredient: mp?.ingredients
        .filter((i) => i.role.code === "WIRKS" || i.role.code === "WIIS" || i.role.code === "WIZUS")
        .map((i) => ({
          itemCodeableConcept: { text: i.name, coding: i.role ? [i.role] : undefined },
          strength: i.strength.structured
            ? {
                numerator: {
                  value: Number(i.strength.numeratorValue),
                  unit: i.strength.numeratorUnit?.code,
                },
                denominator: {
                  value: Number(i.strength.denominatorValue),
                  unit: i.strength.denominatorUnit?.code,
                },
              }
            : undefined,
        })),
      extension: [
        ext("jurisdiction", pkg.jurisdiction),
        ext("identity-authority", pkg.identityAuthority),
        ext("omc-release", releaseLabel),
        ext("regulatory-status", pkg.regulatoryStatus.code, pkg.regulatoryStatus.system),
        pkg.marketingStatus
          ? ext("marketing-status", pkg.marketingStatus.code, pkg.marketingStatus.system)
          : undefined,
        pkg.reimbursementStatus
          ? ext("reimbursement-status", pkg.reimbursementStatus.code, pkg.reimbursementStatus.system)
          : undefined,
        ext("package-description", pkg.description),
        mp ? ext("medicinal-product-id", mp.id) : undefined,
        mp?.productGroupId ? ext("product-group-id", mp.productGroupId) : undefined,
      ].filter(Boolean),
    };
    if (status) resource.status = status;
    if (mp?.names[0]?.text) {
      const code = resource.code as { text: string };
      if (!code.text.includes(mp.names[0].text)) {
        code.text = `${mp.names[0].text} — ${pkg.description}`;
      }
    }
    medications.push(jsonLine(resource));
  }
  return {
    "Medication.ndjson": medications.join(""),
    "Organization.ndjson": orgs.join(""),
  };
}

function ext(urlLeaf: string, value: string, system?: string): Record<string, unknown> {
  const url = `${FHIR_CANONICAL_BASE}/StructureDefinition/${urlLeaf}`;
  if (system) return { url, valueCoding: { system, code: value } };
  return { url, valueString: value };
}

function metaSource(catalogue: Catalogue, identityAuthority: string): string {
  const snap = catalogue.sourceSnapshots.find((s) => s.identityAuthority === identityAuthority);
  return snap?.uri ?? `${FHIR_CANONICAL_BASE}/source/${identityAuthority}`;
}

void stableJson;
