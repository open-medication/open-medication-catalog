import { edqmRouteCoding } from "../adapters/ch/route-edqm.js";
import { SWISSMEDIC_SYSTEMS, type Catalogue, type CodedValue } from "../canonical/types.js";
import { FHIR_CANONICAL_BASE } from "../constants.js";
import { fhirCode, jsonLine, parseFhirDecimal } from "./serialize.js";
import { packageDisplayName, translationExtensions } from "./translation.js";
import { reimbursementDetailExtension } from "./reimbursement.js";

export const R5_MPD_PROFILE = `${FHIR_CANONICAL_BASE}/StructureDefinition/OpenMedicinalProductDefinition`;
export const R5_PPD_PROFILE = `${FHIR_CANONICAL_BASE}/StructureDefinition/OpenPackagedProductDefinition`;

export function exportR5(catalogue: Catalogue, releaseLabel: string): Record<string, string> {
  const mpd: string[] = [];
  const ppd: string[] = [];
  const authz: string[] = [];
  const ing: string[] = [];
  const orgs: string[] = [];

  for (const org of catalogue.organizations) {
    orgs.push(
      jsonLine({
        resourceType: "Organization",
        id: org.id,
        meta: { source: metaSource(catalogue, org.identityAuthority) },
        identifier: org.identifiers,
        name: org.name,
        extension: commonExt(org.jurisdiction, org.identityAuthority, releaseLabel),
      }),
    );
  }

  for (const mp of catalogue.medicinalProducts) {
    mpd.push(
      jsonLine({
        resourceType: "MedicinalProductDefinition",
        id: mp.id,
        meta: {
          profile: [R5_MPD_PROFILE],
          source: metaSource(catalogue, mp.identityAuthority),
        },
        identifier: [
          { system: `${FHIR_CANONICAL_BASE}/sid/resource-id`, value: mp.id },
          ...mp.identifiers,
        ],
        name: [{ productName: mp.names[0]?.text }],
        combinedPharmaceuticalDoseForm: mp.doseForm
          ? {
              coding: [{ ...mp.doseForm, code: fhirCode(mp.doseForm.code) }],
              text: mp.doseForm.display,
            }
          : undefined,
        route: mp.routes.length ? mp.routes.map(routeCodeableConcept) : undefined,
        status: { coding: [mp.regulatoryStatus] },
        extension: [
          ...commonExt(mp.jurisdiction, mp.identityAuthority, releaseLabel),
          mp.productGroupId
            ? {
                url: `${FHIR_CANONICAL_BASE}/StructureDefinition/product-group-id`,
                valueString: mp.productGroupId,
              }
            : undefined,
        ].filter(Boolean),
      }),
    );
    for (const i of mp.ingredients) {
      ing.push(
        jsonLine({
          resourceType: "Ingredient",
          id: i.id,
          meta: { source: metaSource(catalogue, mp.identityAuthority) },
          status: "active",
          for: [{ reference: `MedicinalProductDefinition/${mp.id}` }],
          role: { coding: [i.role], text: i.role.display },
          substance: {
            code: { concept: { text: i.name } },
            strength: ingredientStrength(i.strength),
          },
          extension: commonExt(mp.jurisdiction, mp.identityAuthority, releaseLabel),
        }),
      );
    }
  }

  for (const pkg of catalogue.packages) {
    const display = packageDisplayName(pkg, pkg.description);
    const translations = translationExtensions(pkg.names, display);
    const bagRows = catalogue.reimbursements.filter((r) => r.packageId === pkg.id);
    const dateRange =
      pkg.marketingValidFrom || pkg.marketingValidTo
        ? { start: pkg.marketingValidFrom, end: pkg.marketingValidTo }
        : undefined;
    ppd.push(
      jsonLine({
        resourceType: "PackagedProductDefinition",
        id: pkg.id,
        meta: {
          profile: [R5_PPD_PROFILE],
          source: metaSource(catalogue, pkg.identityAuthority),
        },
        identifier: [
          { system: `${FHIR_CANONICAL_BASE}/sid/resource-id`, value: pkg.id },
          ...pkg.identifiers,
        ],
        name: display,
        _name: translations ? { extension: translations } : undefined,
        description: pkg.description,
        packageFor: [{ reference: `MedicinalProductDefinition/${pkg.medicinalProductId}` }],
        containedItemQuantity: fhirQuantity(pkg.quantity.structured ? pkg.quantity.value : undefined, pkg.quantity.unit?.display ?? pkg.quantity.unit?.code),
        marketingStatus: pkg.marketingStatus
          ? [{ status: { coding: [pkg.marketingStatus] }, dateRange }]
          : undefined,
        extension: [
          ...commonExt(pkg.jurisdiction, pkg.identityAuthority, releaseLabel),
          ...bagRows.map(reimbursementDetailExtension),
        ],
      }),
    );
  }

  for (const a of catalogue.authorizations) {
    authz.push(
      jsonLine({
        resourceType: "RegulatedAuthorization",
        id: a.id,
        meta: { source: metaSource(catalogue, a.identityAuthority) },
        identifier: a.identifiers,
        subject: a.medicinalProductIds.map((id) => ({
          reference: `MedicinalProductDefinition/${id}`,
        })),
        status: { coding: [a.status] },
        holder: a.holderId ? { reference: `Organization/${a.holderId}` } : undefined,
        extension: commonExt(a.jurisdiction, a.identityAuthority, releaseLabel),
      }),
    );
  }

  return {
    "MedicinalProductDefinition.ndjson": mpd.join(""),
    "PackagedProductDefinition.ndjson": ppd.join(""),
    "RegulatedAuthorization.ndjson": authz.join(""),
    "Ingredient.ndjson": ing.join(""),
    "Organization.ndjson": orgs.join(""),
  };
}

function fhirQuantity(value: string | undefined, unit?: string): { value: number; unit?: string }[] | undefined {
  const n = parseFhirDecimal(value);
  if (n === undefined) return undefined;
  return [{ value: n, unit }];
}

function ingredientStrength(strength: {
  structured: boolean;
  numeratorValue?: string;
  numeratorUnit?: { code?: string };
  denominatorValue?: string;
  denominatorUnit?: { code?: string };
  text?: string;
}): unknown {
  const numerator = strength.structured ? parseFhirDecimal(strength.numeratorValue) : undefined;
  const denominator = strength.structured ? parseFhirDecimal(strength.denominatorValue) : undefined;
  if (numerator !== undefined && denominator !== undefined) {
    return [
      {
        presentationRatio: {
          numerator: { value: numerator, unit: strength.numeratorUnit?.code },
          denominator: { value: denominator, unit: strength.denominatorUnit?.code },
        },
        text: strength.text,
      },
    ];
  }
  return strength.text ? [{ text: strength.text }] : undefined;
}

/** Swissmedic ROUTE_ADMIN plus an EDQM coding when the English labels matched. */
export function routeCodeableConcept(route: CodedValue): { coding: CodedValue[]; text?: string } {
  const coding = [route];
  if (route.system === SWISSMEDIC_SYSTEMS.route) {
    const edqm = edqmRouteCoding(route.code);
    if (edqm) coding.push(edqm);
  }
  return { coding, text: route.display };
}

function commonExt(jurisdiction: string, identityAuthority: string, release: string) {
  return [
    { url: `${FHIR_CANONICAL_BASE}/StructureDefinition/jurisdiction`, valueString: jurisdiction },
    { url: `${FHIR_CANONICAL_BASE}/StructureDefinition/identity-authority`, valueString: identityAuthority },
    { url: `${FHIR_CANONICAL_BASE}/StructureDefinition/omc-release`, valueString: release },
  ];
}

function metaSource(catalogue: Catalogue, identityAuthority: string): string {
  const snap = catalogue.sourceSnapshots.find((s) => s.identityAuthority === identityAuthority);
  return snap?.uri ?? `${FHIR_CANONICAL_BASE}/source/${identityAuthority}`;
}
