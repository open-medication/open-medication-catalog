import { FHIR_CANONICAL_BASE } from "../constants.js";
import type { Catalogue, MedicinalProduct, Package } from "../canonical/types.js";
import { jsonLine, parseFhirDecimal } from "./serialize.js";
import { packageDisplayName, translationExtensions } from "./translation.js";
import { reimbursementDetailExtension } from "./reimbursement.js";

export const R4_PROFILE = `${FHIR_CANONICAL_BASE}/StructureDefinition/OpenMedicationPackage`;

/** Catalogue-record lifecycle only. Not marketing or reimbursement. */
export function medicationStatus(pkg: Package): "active" | "inactive" | undefined {
  const code = pkg.regulatoryStatus.code;
  if (code === "D" || code === "BA" || code === "U") return "inactive";
  if (code === "Z" || code === "B" || code === "S" || code === "N" || code === "A") return "active";
  const lower = code.toLowerCase();
  if (/abrog|retir|suspend|inactiv/.test(lower)) return "inactive";
  if (/active/.test(lower)) return "active";
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
    const fallback =
      mp?.names[0]?.text && !pkg.description.includes(mp.names[0].text)
        ? `${mp.names[0].text} — ${pkg.description}`
        : pkg.description;
    const display = packageDisplayName(pkg, fallback);
    const translations = translationExtensions(pkg.names, display);
    const bagRows = catalogue.reimbursements.filter((r) => r.packageId === pkg.id);
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
        text: display,
        _text: translations ? { extension: translations } : undefined,
        coding: pkg.gtin
          ? [{ system: "https://www.gs1.org/gtin", code: pkg.gtin }]
          : productCoding(mp),
      },
      form: mp?.doseForm
        ? { coding: [mp.doseForm], text: mp.doseForm.display ?? mp.doseForm.code }
        : undefined,
      amount: fhirRatio(pkg.quantity.structured ? pkg.quantity.value : undefined, pkg.quantity.unit?.display ?? pkg.quantity.unit?.code, "1"),
      ingredient: mp?.ingredients
        .filter((i) => {
          const code = i.role.code;
          return code === "WIRKS" || code === "WIIS" || code === "WIZUS" || code === "SA" || code === "FT";
        })
        .map((i) => ({
          itemCodeableConcept: { text: i.name, coding: i.role ? [i.role] : undefined },
          strength: fhirRatio(
            i.strength.structured ? i.strength.numeratorValue : undefined,
            i.strength.numeratorUnit?.code,
            i.strength.structured ? i.strength.denominatorValue : undefined,
            i.strength.denominatorUnit?.code,
          ),
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
        ...bagRows.map(reimbursementDetailExtension),
        ext("package-description", pkg.description),
        mp ? ext("medicinal-product-id", mp.id) : undefined,
        mp?.productGroupId ? ext("product-group-id", mp.productGroupId) : undefined,
      ].filter(Boolean),
    };
    if (status) resource.status = status;
    medications.push(jsonLine(resource));
  }
  return {
    "Medication.ndjson": medications.join(""),
    "Organization.ndjson": orgs.join(""),
  };
}

function fhirRatio(
  numerator: string | undefined,
  numeratorUnit: string | undefined,
  denominator?: string,
  denominatorUnit?: string,
): { numerator: { value: number; unit?: string }; denominator: { value: number; unit?: string } } | undefined {
  const n = parseFhirDecimal(numerator);
  const d = parseFhirDecimal(denominator);
  if (n === undefined || d === undefined) return undefined;
  return {
    numerator: { value: n, unit: numeratorUnit },
    denominator: { value: d, unit: denominatorUnit },
  };
}

function ext(urlLeaf: string, value: string, system?: string): Record<string, unknown> {
  const url = `${FHIR_CANONICAL_BASE}/StructureDefinition/${urlLeaf}`;
  if (system) return { url, valueCoding: { system, code: value } };
  return { url, valueString: value };
}

function productCoding(mp: MedicinalProduct | undefined): { system: string; code: string }[] | undefined {
  if (!mp) return undefined;
  const id =
    mp.identifiers.find((i) => i.system.includes("/sequence") || i.system.includes("/cis")) ?? mp.identifiers[0];
  if (!id) return undefined;
  return [{ system: id.system, code: id.value }];
}

function metaSource(catalogue: Catalogue, identityAuthority: string): string {
  const snap = catalogue.sourceSnapshots.find((s) => s.identityAuthority === identityAuthority);
  return snap?.uri ?? `${FHIR_CANONICAL_BASE}/source/${identityAuthority}`;
}
