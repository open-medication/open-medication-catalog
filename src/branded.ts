/** Branded string identifiers. NUMC keys must never be coerced to number. */
declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type AuthorityKey = Brand<string, "AuthorityKey">;
export type AuthorisationNumber = Brand<string, "AuthorisationNumber">;
export type SequenceNumber = Brand<string, "SequenceNumber">;
export type PackageCode = Brand<string, "PackageCode">;
export type EntityId = Brand<string, "EntityId">;

export function asStringKey<T extends string>(value: string, label: string): Brand<string, T> {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string, got ${typeof value}`);
  }
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value as Brand<string, T>;
}

export function asAuthorisationNumber(value: string): AuthorisationNumber {
  return asStringKey(value, "authorisationNumber");
}

export function asSequenceNumber(value: string): SequenceNumber {
  return asStringKey(value, "sequenceNumber");
}

export function asPackageCode(value: string): PackageCode {
  return asStringKey(value, "packageCode");
}

/** Join authority-key parts with `|`. All parts remain unpadded source strings. */
export function authorityKey(parts: readonly string[]): AuthorityKey {
  if (parts.some((p) => typeof p !== "string")) {
    throw new Error("authorityKey parts must be strings");
  }
  return parts.join("|") as AuthorityKey;
}
