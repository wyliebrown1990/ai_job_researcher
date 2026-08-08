import { expect, test, describe } from "bun:test";
import { classifyFundingClaim, parseStage, parseUsdAmount } from "../src/lib/fundingLanguage.ts";

describe("classifyFundingClaim (E5)", () => {
  test("closed rounds are events", () => {
    expect(classifyFundingClaim("HappyRobot Raises $150 Million Series C")).toBe("event");
    expect(classifyFundingClaim("June AI closes $20M pre-seed led by TIME Ventures")).toBe("event");
  });
  test("rumors are not events", () => {
    expect(classifyFundingClaim("Harvey in talks to raise $500M at $15.5B valuation")).toBe("rumor");
    expect(classifyFundingClaim("Startup reportedly raising a new round")).toBe("rumor");
    expect(classifyFundingClaim("X is seeking to raise capital")).toBe("rumor");
  });
  test("rumor language wins over event language (caution)", () => {
    expect(classifyFundingClaim("reportedly raised a round")).toBe("rumor");
  });
  test("no funding language", () => {
    expect(classifyFundingClaim("AI company launches new product")).toBe("none");
  });
});

describe("parseStage", () => {
  test("parses stages", () => {
    expect(parseStage("Series C funding")).toBe("series-c");
    expect(parseStage("pre-seed round")).toBe("pre-seed");
    expect(parseStage("$20M pre seed")).toBe("pre-seed");
    expect(parseStage("Series A")).toBe("series-a");
  });
});

describe("parseUsdAmount", () => {
  test("parses amounts", () => {
    expect(parseUsdAmount("$150 Million")).toBe(150_000_000);
    expect(parseUsdAmount("$1.2 billion")).toBe(1_200_000_000);
    expect(parseUsdAmount("$20M")).toBe(20_000_000);
    expect(parseUsdAmount("no money here")).toBeUndefined();
  });
});
