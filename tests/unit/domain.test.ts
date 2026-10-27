import { describe, it, expect } from "vitest";
import {
  activity,
  publicCounters,
  stockholmToISO,
  daysAgo,
  dayUTC,
  evaluateReadiness,
  streak,
} from "../../src/lib/domain";
import {
  decryptToken,
  encryptToken,
  hashSecret,
  randomSecret,
  signPayload,
  verifyPayload,
} from "../../src/lib/crypto";
describe("public activity", () => {
  it("adds only the four supported components", () =>
    expect(activity({ commits: 11, prs: 2, issues: 3, reviews: 4 })).toBe(20));
  it("uses UTC boundaries across daylight saving dates", () =>
    expect(dayUTC(daysAgo(1, new Date("2026-10-25T00:30:00Z")))).toBe(
      "2026-10-24",
    ));
  it("keeps yesterday's streak until today is over", () =>
    expect(
      streak(
        [
          { day: "2026-10-26", score: 2 },
          { day: "2026-10-25", score: 1 },
        ],
        new Date("2026-10-27T10:00:00Z"),
      ),
    ).toEqual({ count: 2, capped: false }));
  it("does not count gaps", () =>
    expect(
      streak(
        [{ day: "2026-10-25", score: 5 }],
        new Date("2026-10-27T10:00:00Z"),
      ),
    ).toEqual({ count: 0, capped: false }));
});
describe("upstream and campaign boundaries", () => {
  it("never adds restricted counts to the public activity score", () => {
    const publicData = publicCounters({
      totalCommitContributions: 3,
      totalPullRequestContributions: 2,
      totalIssueContributions: 1,
      totalPullRequestReviewContributions: 4,
      restrictedContributionsCount: 100000,
    });
    expect(activity(publicData)).toBe(10);
  });
  it("rejects partial counter responses instead of replacing good data with zeros", () => {
    expect(() => publicCounters({ totalCommitContributions: 3 })).toThrow(
      "github_partial_response",
    );
  });
  it("converts Stockholm campaign dates in winter and summer", () => {
    expect(stockholmToISO("2026-12-01T12:00")).toBe("2026-12-01T11:00:00.000Z");
    expect(stockholmToISO("2026-07-01T12:00")).toBe("2026-07-01T10:00:00.000Z");
    expect(() => stockholmToISO("2026-03-29T02:30")).toThrow();
  });
});
describe("composite readiness", () => {
  const now = Date.parse("2026-10-27T12:00:00Z"),
    healthy = {
      heartbeat_at: new Date(now - 30000),
      revision: "abc",
      oldest_runnable_at: null,
      progress_at: null,
    };
  it("accepts an empty queue with a live matching worker", () =>
    expect(evaluateReadiness(healthy, "abc", now).ok).toBe(true));
  it("rejects a dead worker and another revision", () => {
    expect(
      evaluateReadiness(
        { ...healthy, heartbeat_at: new Date(now - 121000) },
        "abc",
        now,
      ).reason,
    ).toBe("worker_stale");
    expect(evaluateReadiness(healthy, "def", now).reason).toBe(
      "revision_mismatch",
    );
  });
  it("detects a runnable queue that makes no progress", () =>
    expect(
      evaluateReadiness(
        { ...healthy, oldest_runnable_at: new Date(now - 700000) },
        "abc",
        now,
      ).reason,
    ).toBe("queue_stalled"));
  it("allows a busy queue that still progresses", () =>
    expect(
      evaluateReadiness(
        {
          ...healthy,
          oldest_runnable_at: new Date(now - 700000),
          progress_at: new Date(now - 10000),
        },
        "abc",
        now,
      ).ok,
    ).toBe(true));
  it("waits for the worker on cold start", () =>
    expect(evaluateReadiness(undefined, "abc", now).ok).toBe(false));
});
describe("credentials", () => {
  it("encrypts OAuth tokens with authenticated randomized ciphertext", () => {
    process.env.TOKEN_ENCRYPTION_KEY = "1".repeat(64);
    const a = encryptToken("private-github-token"),
      b = encryptToken("private-github-token");
    expect(a).not.toContain("private-github-token");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("private-github-token");
    expect(() => decryptToken(a.slice(0, -3) + "xxx")).toThrow();
  });
  it("rejects altered exposure and cursor signatures", () => {
    const token = signPayload({ id: "hello" }, "test-key");
    expect(verifyPayload(token, "test-key")).toEqual({ id: "hello" });
    expect(verifyPayload(token + "bad", "test-key")).toBeNull();
    expect(verifyPayload(token, "wrong-key")).toBeNull();
  });
  it("uses high-entropy independently generated registration secrets", () => {
    const a = randomSecret(),
      b = randomSecret();
    expect(a).not.toBe(b);
    expect(hashSecret(a)).toHaveLength(64);
    expect(hashSecret(a)).not.toContain(a);
  });
});
