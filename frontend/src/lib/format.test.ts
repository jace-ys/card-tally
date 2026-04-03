import { describe, expect, it } from "vitest";
import { formatAmount } from "./format";

describe("formatAmount", () => {
  it("formats numeric strings with two decimals", () => {
    expect(formatAmount("19.37")).toMatch(/19\.37/);
  });

  it("returns original when not a number", () => {
    expect(formatAmount("n/a")).toBe("n/a");
  });
});
