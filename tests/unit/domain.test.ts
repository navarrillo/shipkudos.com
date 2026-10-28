import { describe, it, expect, vi } from "vitest";
import {
  activity,
  PUBLIC_REPOSITORY_LIMIT,
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
function repo(
  isPrivate: boolean,
  visibility: string,
  totalCount: number,
  nameWithOwner?: string,
) {
  return {
    repository: { isPrivate, visibility, nameWithOwner },
    contributions: { totalCount },
  };
}
describe("upstream and campaign boundaries", () => {
  it("never adds restricted counts to the public activity score", () => {
    const publicData = publicCounters({
      totalCommitContributions: 3,
      totalPullRequestContributions: 2,
      totalIssueContributions: 1,
      totalPullRequestReviewContributions: 4,
      restrictedContributionsCount: 100000,
      contributionCalendar: { totalContributions: 100010 },
    });
    expect(activity(publicData)).toBe(10);
    expect(publicData).toEqual({ commits: 3, prs: 2, issues: 1, reviews: 4 });
  });
  it("drops private and internal repositories when the aggregate includes them", () => {
    const counted = publicCounters({
      totalCommitContributions: 4 + 88881 + 77771,
      totalPullRequestContributions: 3 + 50,
      totalIssueContributions: 2,
      totalPullRequestReviewContributions: 1 + 9,
      restrictedContributionsCount: 99991,
      commitContributionsByRepository: [
        repo(false, "PUBLIC", 4),
        repo(true, "PRIVATE", 88881, "secret/hidden-repo"),
        repo(true, "INTERNAL", 77771),
      ],
      pullRequestContributionsByRepository: [
        repo(false, "PUBLIC", 3),
        repo(true, "PRIVATE", 50),
      ],
      issueContributionsByRepository: [repo(false, "PUBLIC", 2)],
      pullRequestReviewContributionsByRepository: [
        repo(false, "PUBLIC", 1),
        repo(false, "INTERNAL", 9),
      ],
    });
    expect(counted).toEqual({ commits: 4, prs: 3, issues: 2, reviews: 1 });
    expect(activity(counted)).toBe(10);
    expect(JSON.stringify(counted)).not.toContain("hidden-repo");
  });
  it("keeps the public aggregate when no private repository is listed", () => {
    expect(
      publicCounters({
        totalCommitContributions: 10,
        totalPullRequestContributions: 0,
        totalIssueContributions: 0,
        totalPullRequestReviewContributions: 0,
        commitContributionsByRepository: [repo(false, "PUBLIC", 4)],
      }),
    ).toMatchObject({ commits: 10 });
  });
  it("keeps the public sum when a 100-repository list cannot be reconciled", () => {
    const repos = Array.from({ length: PUBLIC_REPOSITORY_LIMIT }, (_, index) =>
      repo(
        index === 0,
        index === 0 ? "PRIVATE" : "PUBLIC",
        1,
        "secret/hidden-repo",
      ),
    );
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      logs.push(String(line));
    });
    try {
      expect(
        publicCounters({
          totalCommitContributions: 1000,
          totalPullRequestContributions: 0,
          totalIssueContributions: 0,
          totalPullRequestReviewContributions: 0,
          commitContributionsByRepository: repos,
        }),
      ).toMatchObject({ commits: 99 });
      expect(logs).toEqual([
        JSON.stringify({
          event: "github_truncated_contributions",
          category: "commits",
        }),
      ]);
      expect(logs.join("\n")).not.toContain("hidden-repo");
    } finally {
      spy.mockRestore();
    }
  });
  it("accepts exactly 100 repositories when public plus private equals the total", () => {
    const repos = Array.from({ length: PUBLIC_REPOSITORY_LIMIT }, (_, index) =>
      repo(
        index < 40,
        index < 40 ? "PRIVATE" : "PUBLIC",
        2,
        `owner/repo-${index}`,
      ),
    );
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line) => {
      logs.push(String(line));
    });
    try {
      expect(
        publicCounters({
          totalCommitContributions: 200,
          totalPullRequestContributions: 0,
          totalIssueContributions: 0,
          totalPullRequestReviewContributions: 0,
          commitContributionsByRepository: repos,
        }),
      ).toMatchObject({ commits: 120 });
      expect(logs.join("\n")).not.toContain("github_truncated_contributions");
      expect(logs.join("\n")).not.toContain("owner/repo-");
    } finally {
      spy.mockRestore();
    }
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
