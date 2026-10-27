import { describe, expect, it } from "vitest";
import { RANKING_PENDING_MESSAGE, awaitingRankingUpdate } from "../../src/lib/domain";
import {
  RANK_REBUILD_AFTER_SYNC_MS,
  RANK_REBUILD_INTERVAL_MS,
  rebuildRankingsIfDue,
  recordGitHubSync,
  rankingsDue,
  type RankState,
} from "../../src/lib/rankings";

const at = 1_700_000_000_000;
function fresh(): RankState {
  return { lastRank: at, syncs: 0, covered: 0 };
}

describe("ranking schedule", () => {
  it("keeps the 15 minute rebuild and waits 60 seconds after a sync", () => {
    expect(RANK_REBUILD_INTERVAL_MS).toBe(900_000);
    expect(RANK_REBUILD_AFTER_SYNC_MS).toBe(60_000);
    const idle = fresh();
    expect(rankingsDue(idle, at + RANK_REBUILD_INTERVAL_MS)).toBe(false);
    expect(rankingsDue(idle, at + RANK_REBUILD_INTERVAL_MS + 1)).toBe(true);
    const dirty = fresh();
    recordGitHubSync(dirty, true);
    expect(rankingsDue(dirty, at + RANK_REBUILD_AFTER_SYNC_MS - 1)).toBe(false);
    expect(rankingsDue(dirty, at + RANK_REBUILD_AFTER_SYNC_MS)).toBe(true);
    const failed = fresh();
    recordGitHubSync(failed, false);
    expect(rankingsDue(failed, at + RANK_REBUILD_AFTER_SYNC_MS)).toBe(false);
  });
  it("resets the dirty flag after a rebuild and keeps a sync that lands during it", async () => {
    const state = fresh();
    recordGitHubSync(state, true);
    expect(
      await rebuildRankingsIfDue(state, at + 1_000, async () => {
        recordGitHubSync(state, true);
      }),
    ).toBe(false);
    expect(
      await rebuildRankingsIfDue(state, at + RANK_REBUILD_AFTER_SYNC_MS, async () => {
        recordGitHubSync(state, true);
      }),
    ).toBe(true);
    expect(state.lastRank).toBe(at + RANK_REBUILD_AFTER_SYNC_MS);
    expect(state.syncs).toBe(2);
    expect(state.covered).toBe(1);
    expect(rankingsDue(state, state.lastRank + RANK_REBUILD_AFTER_SYNC_MS - 1)).toBe(
      false,
    );
    expect(rankingsDue(state, state.lastRank + RANK_REBUILD_AFTER_SYNC_MS)).toBe(
      true,
    );
  });
});

describe("dashboard ranking notice", () => {
  const synced = "2026-10-27T12:00:00.000Z";
  it("shows the pending copy only when a published sync is ahead of the snapshot", () => {
    expect(RANKING_PENDING_MESSAGE).toBe(
      "Synced — you'll appear on the leaderboard at the next ranking update (within a minute)",
    );
    expect(awaitingRankingUpdate(synced, synced, null)).toBe(true);
    expect(awaitingRankingUpdate(synced, synced, "2026-10-27T11:59:00.000Z")).toBe(
      true,
    );
    expect(awaitingRankingUpdate(synced, synced, synced)).toBe(false);
    expect(
      awaitingRankingUpdate(synced, synced, "2026-10-27T12:00:01.000Z"),
    ).toBe(false);
    expect(awaitingRankingUpdate(null, synced, null)).toBe(false);
    expect(awaitingRankingUpdate(synced, null, null)).toBe(false);
  });
});
