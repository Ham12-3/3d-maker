import { describe, expect, it } from "vitest";
import { isAllowedFileUrl, isValidModelId, licenseOf, toCandidate } from "./polypizza";

const fish = {
  ID: "52s3JpUSjmX",
  Title: "Fish",
  Attribution:
    "Fish by jeremy, https://poly.pizza/m/52s3JpUSjmX. Licence at https://creativecommons.org/licenses/by/3.0",
  Thumbnail: "https://static.poly.pizza/x.webp",
  Download: "https://static.poly.pizza/x.glb",
  "Tri Count": 274,
  Licence: "CC-BY 3.0",
  Animated: false,
};

describe("poly pizza", () => {
  it("maps licences", () => {
    expect(licenseOf("CC0 1.0")).toBe("CC0");
    expect(licenseOf("CC-BY 3.0")).toBe("CC-BY");
    expect(licenseOf("Something else")).toBe("other");
    expect(licenseOf(undefined)).toBe("other");
  });

  it("maps a model to a proxied candidate with attribution", () => {
    const c = toCandidate(fish, "fish", 0);
    expect(c).toMatchObject({
      source: "polypizza",
      id: "52s3JpUSjmX",
      url: "/api/assets/file/52s3JpUSjmX",
      license: "CC-BY",
      triCount: 274,
    });
    expect(c.attribution).toMatch(/jeremy/);
    expect(c.score).toBeGreaterThan(toCandidate({ ...fish, Title: "Shark" }, "fish", 0).score);
  });

  it("only proxies model files from the Poly Pizza file host", () => {
    expect(isAllowedFileUrl("https://static.poly.pizza/abc.glb")).toBe(true);
    expect(isAllowedFileUrl("https://evil.example/abc.glb")).toBe(false);
    expect(isAllowedFileUrl("http://static.poly.pizza/abc.glb")).toBe(false);
    expect(isAllowedFileUrl("https://static.poly.pizza/abc.png")).toBe(false);
    expect(isAllowedFileUrl("not a url")).toBe(false);
  });

  it("validates model ids", () => {
    expect(isValidModelId("52s3JpUSjmX")).toBe(true);
    expect(isValidModelId("../etc/passwd")).toBe(false);
    expect(isValidModelId("a")).toBe(false);
  });
});
