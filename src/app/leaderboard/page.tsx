import Link from "next/link";
import { cachedLeaderboard } from "@/lib/data";
import { Ranking } from "@/components/ranking";
import { Ad } from "@/components/ad";
export const dynamic = "force-dynamic";
export const metadata = { title: "Leaderboard" };
export default async function Leaderboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams,
    period = params.period === "30" ? 30 : 7,
    search = (params.q || "").slice(0, 80);
  const result = await cachedLeaderboard(period, search, params.cursor).catch(
    () => null,
  );
  return (
    <>
      <div className="page-head">
        <div className="eyebrow">
          <span className="status-dot" />
          PUBLIC ACTIVITY / GLOBAL BOARD
        </div>
        <h1>
          Meet the people
          <br />
          moving things forward.
        </h1>
        <p>A little friendly competition. A lot of building.</p>
      </div>
      <Ad />
      <div className="toolbar">
        <form action="/leaderboard" className="flex gap-2">
          <input type="hidden" name="period" value={period} />
          <input
            className="search"
            name="q"
            defaultValue={search}
            placeholder="Search a participating builder…"
            aria-label="Search builders"
          />
          <button className="button button-outline" type="submit">
            Search
          </button>
        </form>
        <div className="periods">
          {[7, 30].map((p) => (
            <Link
              key={p}
              className={p === period ? "selected" : ""}
              href={`/leaderboard?period=${p}`}
            >
              {p} DAYS
            </Link>
          ))}
        </div>
      </div>
      {result ? (
        <>
          <Ranking entries={result.entries} />
          {result.nextCursor && (
            <div className="my-6">
              <Link
                className="button button-outline"
                href={`/leaderboard?period=${period}&q=${encodeURIComponent(search)}&cursor=${encodeURIComponent(result.nextCursor)}`}
              >
                Next 50 builders →
              </Link>
            </div>
          )}
          <p className="subtle text-xs my-5">
            {result.snapshot
              ? `Snapshot: ${new Date(result.snapshot.created_at).toUTCString()}.`
              : "The first snapshot will appear after a builder's initial sync."}{" "}
            Updated within a minute of a successful sync, and at least every
            15 minutes.{" "}
            <Link className="lime" href="/methodology">
              How ranking works ↗
            </Link>
          </p>
        </>
      ) : (
        <div className="panel">
          <p>This ranking is updating or temporarily unavailable.</p>
          <Link href="/leaderboard" className="text-link">
            Reload the board →
          </Link>
        </div>
      )}
      <div className="mb-12" />
    </>
  );
}
