/** Official RPL XML 6.0.0 element and attribute names */
export class RplXml {
  static readonly medicinalProducts = "produktyLecznicze";
  static readonly asOfDate = "stanNaDzien";
  static readonly xmlns = "xmlns";
  static readonly medicinalProduct = "produktLeczniczy";
  static readonly id = "id";
  static readonly productName = "nazwaProduktu";
  static readonly preparationType = "rodzajPreparatu";
  static readonly commonName = "nazwaPowszechnieStosowana";
  static readonly previousProductName = "nazwaPoprzedniaProduktu";
  static readonly strength = "moc";
  static readonly doseFormName = "nazwaPostaciFarmaceutycznej";
  static readonly marketingAuthorisationHolder = "podmiotOdpowiedzialny";
  static readonly procedureType = "typProcedury";
  static readonly authorisationNumber = "numerPozwolenia";
  static readonly authorisationValidity = "waznoscPozwolenia";
  static readonly legalBasis = "podstawaPrawna";
  static readonly animalUseProhibition = "zakazStosowaniaUZwierzat";
  static readonly patientLeafletUrl = "ulotka";
  static readonly smpcUrl = "charakterystyka";
  static readonly atcCodes = "kodyATC";
  static readonly atcCode = "kodATC";
  static readonly routesOfAdministration = "drogiPodania";
  static readonly routeOfAdministration = "drogaPodania";
  static readonly routeName = "drogaPodaniaNazwa";
  static readonly activeSubstances = "substancjeCzynne";
  static readonly activeSubstance = "substancjaCzynna";
  static readonly substanceName = "nazwaSubstancji";
  static readonly substanceQuantity = "iloscSubstancji";
  static readonly substanceQuantityUnit = "jednostkaMiaryIlosciSubstancji";
  static readonly preparationQuantity = "iloscPreparatu";
  static readonly preparationQuantityUnit = "jednostkaMiaryIlosciPreparatu";
  static readonly otherQuantityDescription = "innyOpisIlosci";
  static readonly packages = "opakowania";
  static readonly pack = "opakowanie";
  static readonly gtinCode = "kodGTIN";
  static readonly availabilityCategory = "kategoriaDostepnosci";
  static readonly cancelled = "skasowane";
  static readonly euNumber = "numerEu";
  static readonly parallelDistributor = "dystrybutorRownolegly";
  static readonly packUnits = "jednostkiOpakowania";
  static readonly packUnit = "jednostkaOpakowania";
  static readonly packCount = "liczbaOpakowan";
  static readonly packKind = "rodzajOpakowania";
  static readonly capacity = "pojemnosc";
  static readonly capacityUnit = "jednostkaPojemnosci";
  static readonly additionalInfo = "informacjeDodatkowe";
  static readonly presidentConsents = "zgodyPrezesa";
  static readonly manufacturerData = "daneOWytworcy";
  static readonly manufacturer = "wytworcy";
  static readonly manufacturerImporterName = "nazwaWytworcyImportera";
  static readonly manufacturerImporterCountry = "krajWytworcyImportera";
  static readonly educationalMaterials = "materialyEdukacyjne";
  static readonly forPatient = "dlaPacjenta";
  static readonly forHealthcareProfessional = "dlaMedyka";

  static readonly veterinaryIgnored = `${RplXml.medicinalProduct}.${RplXml.preparationType}[veterinary]`;
  static readonly incompleteIgnored = `${RplXml.medicinalProduct}[incomplete]`;

  static readonly repeating = [
    RplXml.medicinalProduct,
    RplXml.atcCode,
    RplXml.routeOfAdministration,
    RplXml.activeSubstance,
    RplXml.pack,
    RplXml.packUnit,
    RplXml.manufacturer,
  ] as const;
}

/** Recurring coded values in the RPL dump (not element names). */
export class RplValue {
  static readonly human = "ludzki";
  static readonly none = "brak";
  static readonly yes = "TAK";
  static readonly cancelled = "skasowane";
  static readonly parallelImport = "import-rownolegly";
  static readonly activeSubstanceRole = "substancja czynna";
}
