import { describe, it, expect } from "vitest";
import {
  determineMaturityStatus,
  calculateProgressPercent,
} from "./progress";

describe("determineMaturityStatus", () => {
  it("returns 'not_started' when no questions answered", () => {
    const result = determineMaturityStatus({
      answeredCount: 0,
      totalQuestions: 10,
      updateInProgress: false,
    });
    expect(result).toBe("not_started");
  });

  it("returns 'in_progress' when some questions answered", () => {
    const result = determineMaturityStatus({
      answeredCount: 5,
      totalQuestions: 10,
      updateInProgress: false,
    });
    expect(result).toBe("in_progress");
  });

  it("returns 'completed' when all questions answered", () => {
    const result = determineMaturityStatus({
      answeredCount: 10,
      totalQuestions: 10,
      updateInProgress: false,
    });
    expect(result).toBe("completed");
  });

  it("returns 'completed' when more answers than questions (edge case)", () => {
    const result = determineMaturityStatus({
      answeredCount: 12,
      totalQuestions: 10,
      updateInProgress: false,
    });
    expect(result).toBe("completed");
  });

  it("returns 'update_in_progress' when update is in progress, regardless of answer count", () => {
    const result = determineMaturityStatus({
      answeredCount: 10,
      totalQuestions: 10,
      updateInProgress: true,
    });
    expect(result).toBe("update_in_progress");
  });

  it("prioritizes 'update_in_progress' over 'not_started'", () => {
    const result = determineMaturityStatus({
      answeredCount: 0,
      totalQuestions: 10,
      updateInProgress: true,
    });
    expect(result).toBe("update_in_progress");
  });
});

describe("calculateProgressPercent", () => {
  it("returns 0 when no questions answered", () => {
    expect(calculateProgressPercent(0, 10)).toBe(0);
  });

  it("returns 50 when half answered", () => {
    expect(calculateProgressPercent(5, 10)).toBe(50);
  });

  it("returns 100 when all answered", () => {
    expect(calculateProgressPercent(10, 10)).toBe(100);
  });

  it("returns 0 when total questions is 0 (edge case)", () => {
    expect(calculateProgressPercent(0, 0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    expect(calculateProgressPercent(1, 3)).toBe(33);
    expect(calculateProgressPercent(2, 3)).toBe(67);
  });
});
