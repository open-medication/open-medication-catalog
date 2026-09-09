import { describe, expect, it } from "vitest";
import { edqmRouteCoding, EDQM_ROUTE_SYSTEM, loadRouteEdqmMap } from "../src/adapters/ch/route-edqm.js";
import { SWISSMEDIC_SYSTEMS } from "../src/canonical/types.js";
import { routeCodeableConcept } from "../src/fhir/r5.js";

describe("Swissmedic ROUTE_ADMIN to EDQM", () => {
  it("maps oral and intravenous by exact English label", () => {
    expect(edqmRouteCoding("ORA")).toEqual({
      system: EDQM_ROUTE_SYSTEM,
      code: "20053000",
      display: "Oral use",
    });
    expect(edqmRouteCoding("IV")?.code).toBe("20045000");
  });

  it("maps both inhalation mnemonics to the same EDQM term", () => {
    expect(edqmRouteCoding("INH")?.code).toBe("20020000");
    expect(edqmRouteCoding("RESP")?.code).toBe("20020000");
  });

  it("does not invent a mapping for unmatched veterinary labels", () => {
    expect(edqmRouteCoding("VER")).toBeUndefined();
    expect(edqmRouteCoding("IMAM")).toBeUndefined();
    expect(edqmRouteCoding("SPO")).toBeUndefined();
  });

  it("covers every mapped YAML key with an 8-digit EDQM code", () => {
    const { map } = loadRouteEdqmMap();
    expect(Object.keys(map).length).toBe(48);
    for (const [sm, hit] of Object.entries(map)) {
      expect(sm.length).toBeGreaterThan(0);
      expect(hit.code).toMatch(/^20\d{6}$/);
    }
  });

  it("adds EDQM as a second FHIR coding and keeps Swissmedic first", () => {
    const concept = routeCodeableConcept({
      system: SWISSMEDIC_SYSTEMS.route,
      code: "ORA",
      display: "Oral use",
    });
    expect(concept.coding).toHaveLength(2);
    expect(concept.coding[0]?.system).toBe(SWISSMEDIC_SYSTEMS.route);
    expect(concept.coding[1]?.system).toBe(EDQM_ROUTE_SYSTEM);
    expect(concept.coding[1]?.code).toBe("20053000");
    expect(concept.text).toBe("Oral use");
  });

  it("leaves unmatched Swissmedic routes as a single coding", () => {
    const concept = routeCodeableConcept({
      system: SWISSMEDIC_SYSTEMS.route,
      code: "VER",
      display: "zum Vernebeln",
    });
    expect(concept.coding).toHaveLength(1);
    expect(concept.coding[0]?.system).toBe(SWISSMEDIC_SYSTEMS.route);
  });
});
