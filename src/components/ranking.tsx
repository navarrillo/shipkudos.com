import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  GitCommitHorizontal,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import type { RankedProfile } from "@/lib/data";
export function Ranking({
  entries,
  compact = false,
}: {
  entries: RankedProfile[];
  compact?: boolean;
}) {
  return (
    <div className="ranking-scroll">
      <table className="ranking">
        <thead>
          <tr>
            <th className="rank-cell">RANK</th>
            <th>BUILDER</th>
            <th className="optional">
              STACK <span className="normal-case">(declared)</span>
            </th>
            <th className="numeric">ACTIVITY</th>
            <th className="numeric optional">ACTIVE DAYS</th>
            <th aria-label="Open profile" />
          </tr>
        </thead>
        <tbody>
          {entries.map((p) => (
            <tr key={p.id}>
              <td
                className={`rank-cell mono ${p.position <= 3 ? "lime" : "subtle"}`}
              >
                {String(p.position).padStart(2, "0")}
              </td>
              <td>
                <Link href={`/u/${p.login}`} className="builder">
                  {p.avatar && (
                    <Image
                      unoptimized
                      src={p.avatar}
                      width={36}
                      height={36}
                      alt=""
                      className="avatar"
                    />
                  )}
                  <span>
                    <strong>{p.name}</strong>
                    <small>
                      @{p.login} <ShieldCheck size={12} />
                    </small>
                  </span>
                </Link>
              </td>
              <td className="optional">
                <div className="tags">
                  {p.tools.slice(0, 2).map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                  {!p.tools.length && (
                    <span className="subtle">Not shared</span>
                  )}
                </div>
              </td>
              <td className="numeric mono">
                <GitCommitHorizontal size={15} />
                {p.score.toLocaleString("en")}
              </td>
              <td className="numeric optional mono subtle">
                {p.active_days}
                <span className="subtle">d</span>
              </td>
              <td>
                <Link href={`/u/${p.login}`} aria-label={`View ${p.login}`}>
                  <ArrowUpRight size={17} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!entries.length && (
        <div className="empty">
          <Terminal size={28} />
          <h3>The next name here could be yours.</h3>
          <p>
            Connect GitHub and publish your profile to join the first builders.
          </p>
          <Link href="/dashboard" className="text-link">
            Claim your place <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
      {compact && (
        <Link href="/leaderboard" className="table-footer">
          Explore the leaderboard <ArrowUpRight size={16} />
        </Link>
      )}
    </div>
  );
}
