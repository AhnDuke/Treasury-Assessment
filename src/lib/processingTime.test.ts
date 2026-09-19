import { describe, expect, it } from "vitest";
import {
  classifyProcessingTime,
  formatProcessingTime,
  summariseProcessingTimes,
  TARGET_PROCESSING_MS,
} from "./processingTime";

describe("TARGET_PROCESSING_MS", () => {
  it("is the 5 seconds the interviews called the point of abandonment", () => {
    // Pinned as a test, not just a constant: the number comes from a
    // stakeholder requirement, so changing it should be a deliberate act that
    // fails a test rather than a quiet edit.
    expect(TARGET_PROCESSING_MS).toBe(5000);
  });
});

describe("classifyProcessingTime", () => {
  it("counts exactly five seconds as within the target, not over it", () => {
    expect(classifyProcessingTime(5000)).toBe("within");
    expect(classifyProcessingTime(5001)).toBe("over");
  });

  it("treats an unrecorded duration as unknown rather than as fast", () => {
    // A queued row has no duration yet. Reporting that as "within target"
    // would flatter the numbers with rows that were never checked.
    expect(classifyProcessingTime(null)).toBe("unknown");
    expect(classifyProcessingTime(undefined)).toBe("unknown");
    expect(classifyProcessingTime(Number.NaN)).toBe("unknown");
    expect(classifyProcessingTime(-1)).toBe("unknown");
  });
});

describe("formatProcessingTime", () => {
  it("keeps sub-second precision where a person would notice it", () => {
    expect(formatProcessingTime(420)).toBe("420ms");
    expect(formatProcessingTime(3400)).toBe("3.4s");
  });

  it("drops the decimal once it stops meaning anything", () => {
    expect(formatProcessingTime(12400)).toBe("12s");
    expect(formatProcessingTime(95000)).toBe("1m 35s");
  });

  it("renders a missing duration as a dash rather than 0ms", () => {
    expect(formatProcessingTime(null)).toBe("-");
    expect(formatProcessingTime(undefined)).toBe("-");
  });
});

describe("summariseProcessingTimes", () => {
  it("reports the spread and how many cleared the target", () => {
    const stats = summariseProcessingTimes([1000, 2000, 3000, 4000, 12000])!;
    expect(stats.count).toBe(5);
    expect(stats.min).toBe(1000);
    expect(stats.median).toBe(3000);
    expect(stats.max).toBe(12000);
    expect(stats.withinTarget).toBe(4);
    expect(stats.overTarget).toBe(1);
  });

  it("is not fooled by unsorted input", () => {
    const stats = summariseProcessingTimes([12000, 1000, 4000, 2000, 3000])!;
    expect(stats.min).toBe(1000);
    expect(stats.median).toBe(3000);
    expect(stats.max).toBe(12000);
  });

  it("ignores unusable samples instead of counting them as zero", () => {
    const stats = summariseProcessingTimes([1000, Number.NaN, -5, 3000])!;
    expect(stats.count).toBe(2);
    expect(stats.min).toBe(1000);
  });

  it("returns null when there is nothing to summarise", () => {
    expect(summariseProcessingTimes([])).toBeNull();
    expect(summariseProcessingTimes([Number.NaN])).toBeNull();
  });
});
