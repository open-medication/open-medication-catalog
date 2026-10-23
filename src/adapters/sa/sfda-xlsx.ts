import type { MappingCoverageReport } from "../../canonical/types.js";

/** Headers from Human Drug List 4-2026.xlsx (normalized lowercase). */
export const HEADER_ALIASES: Record<string, string> = {
  "registernumber": "registerNumber",
  "registeryear": "registerYear",
  "certificate date": "certificateDate",
  "product type": "productType",
  "drugtype": "drugType",
  "scientific name": "scientificName",
  "trade name": "tradeName",
  "strength": "strength",
  "strengthunit": "strengthUnit",
  "pharmaceuticalform": "doseForm",
  "administrationroute": "route",
  "atccode1": "atcCode1",
  "atccode2": "atcCode2",
  "size": "size",
  "sizeunit": "sizeUnit",
  "packagetypes": "packageType",
  "packagesize": "packageSize",
  "legal status": "legalStatus",
  "product control": "productControl",
  "distribute area": "distributionSite",
  "public price": "price",
  "pricing date": "pricingDate",
  "shelflife": "shelfLife",
  "storage conditions": "storageConditions",
  "storage condition arabic": "storageConditionsArabic",
  "marketing company": "marketingCompany",
  "marketing denr companyid": "marketingCompanyId",
  "marketing country": "marketingCompanyCountry",
  "manufacture name": "manufacturerName",
  "manufacture country": "manufacturerCountry",
  "2nd manufacture name": "secondManufacturerName",
  "2nd manufacture country": "secondManufacturerCountry",
  "main agent": "firstAgent",
  "secosnd agent": "secondAgent",
  "third agent": "thirdAgent",
  "marketing status": "marketingStatus",
  "authorization status": "authorizationStatus",
  "descriptioncode": "descriptionCode",
  "gtin": "gtin",
};

export interface MappingFile {
  files: Record<string, Record<string, MappingCoverageReport["fields"][number]["classification"]>>;
}

export interface SfdaParsed {
  rows: Record<string, string>[];
  originalHeaders: Record<string, string>;
  coverage: MappingCoverageReport;
}

export function normalizeHeader(header: string): string {
  return header.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function canonicalSfdaHeader(header: string): string | undefined {
  return HEADER_ALIASES[normalizeHeader(header)];
}
