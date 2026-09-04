import { describe, it, expect } from "vitest";
import { markdownToSlack } from "./markdown";

describe("markdownToSlack", () => {
  describe("bold text", () => {
    it("converts **bold** to *bold*", () => {
      expect(markdownToSlack("**hello**")).toBe("*hello*");
    });

    it("converts __bold__ to *bold*", () => {
      expect(markdownToSlack("__hello__")).toBe("*hello*");
    });
  });

  describe("headers", () => {
    it("converts # Header to *Header*", () => {
      expect(markdownToSlack("# Hello")).toBe("*Hello*");
    });

    it("converts ## Header to *Header*", () => {
      expect(markdownToSlack("## Hello")).toBe("*Hello*");
    });

    it("converts ### Header to *Header*", () => {
      expect(markdownToSlack("### Hello")).toBe("*Hello*");
    });
  });

  describe("links", () => {
    it("converts [text](url) to <url|text>", () => {
      expect(markdownToSlack("[Click here](https://example.com)")).toBe(
        "<https://example.com|Click here>"
      );
    });
  });

  describe("bullet points", () => {
    it("converts * item to • item", () => {
      expect(markdownToSlack("* First item")).toBe("• First item");
    });

    it("handles multiple bullet points", () => {
      const input = "* First\n* Second\n* Third";
      const expected = "• First\n• Second\n• Third";
      expect(markdownToSlack(input)).toBe(expected);
    });
  });

  describe("horizontal rules", () => {
    it("converts --- to visual separator", () => {
      expect(markdownToSlack("---")).toBe("─────────────────────────");
    });

    it("converts *** to visual separator", () => {
      expect(markdownToSlack("***")).toBe("─────────────────────────");
    });

    it("converts ___ to visual separator", () => {
      expect(markdownToSlack("___")).toBe("─────────────────────────");
    });
  });

  describe("combined formatting", () => {
    it("handles mixed content", () => {
      const input = "## Title\n\n**Bold text** and [a link](https://example.com)\n\n* Item one\n* Item two";
      const result = markdownToSlack(input);

      expect(result).toContain("*Title*");
      expect(result).toContain("*Bold text*");
      expect(result).toContain("<https://example.com|a link>");
      expect(result).toContain("• Item one");
      expect(result).toContain("• Item two");
    });
  });
});
