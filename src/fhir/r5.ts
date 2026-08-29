import { FHIR_CANONICAL_BASE } from "../constants.js";
import type { Catalogue } from "../canonical/types.js";
import { jsonLine } from "./serialize.js";

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
          ? { coding: [mp.doseForm], text: mp.doseForm.display }
          : undefined,
        route: mp.routes.map((r) => ({ coding: [r], text: r.display })),
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
            strength: i.strength.structured
              ? [
                  {
                    presentationRatio: {
                      numerator: {
                        value: Number(i.strength.numeratorValue),
                        unit: i.strength.numeratorUnit?.code,
                      },
                      denominator: {
                        value: Number(i.strength.denominatorValue),
                        unit: i.strength.denominatorUnit?.code,
                      },
                    },
                    text: i.strength.text,
                  },
                ]
              : i.strength.text
                ? [{ text: i.strength.text }]
                : undefined,
          },
          extension: commonExt(mp.jurisdiction, mp.identityAuthority, releaseLabel),
        }),
      );
    }
  }

  for (const pkg of catalogue.packages) {
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
        name: pkg.description,
        description: pkg.description,
        packageFor: [{ reference: `MedicinalProductDefinition/${pkg.medicinalProductId}` }],
        containedItemQuantity: pkg.quantity.structured
          ? [
              {
                value: Number(pkg.quantity.value),
                unit: pkg.quantity.unit?.display ?? pkg.quantity.unit?.code,
              },
            ]
          : undefined,
        marketingStatus: pkg.marketingStatus
          ? [{ status: { coding: [pkg.marketingStatus] } }]
          : undefined,
        extension: commonExt(pkg.jurisdiction, pkg.identityAuthority, releaseLabel),
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
