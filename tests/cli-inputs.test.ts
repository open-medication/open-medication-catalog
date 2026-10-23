import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/cli-inputs.js";

describe("parseInputs", () => {
  it("maps source=path explicitly", () => {
    expect(parseInputs(["rpl=/tmp/rpl.zip"])).toEqual({ rpl: "/tmp/rpl.zip" });
  });

  it("maps a bare path to the recipe's primary source by default", () => {
    expect(parseInputs(["/tmp/in.zip"])).toEqual({ swissmedic: "/tmp/in.zip" });
  });

  it("maps a bare path to the single custom --source", () => {
    expect(parseInputs(["/tmp/drugs.xlsx"], undefined, ["sfda"])).toEqual({
      sfda: "/tmp/drugs.xlsx",
    });
  });

  it("does not apply the custom fallback when more than one source is given", () => {
    expect(parseInputs(["/tmp/in.zip"], undefined, ["sfda", "rpl"])).toEqual({
      swissmedic: "/tmp/in.zip",
    });
  });

  it("prefers an explicit source=path over the fallback", () => {
    expect(parseInputs(["rpl=/tmp/rpl.zip"], undefined, ["sfda"])).toEqual({
      rpl: "/tmp/rpl.zip",
    });
  });
});