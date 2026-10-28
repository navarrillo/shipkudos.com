import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  GitCommitHorizontal,
  ShieldCheck,
  Bot,
  Terminal,
  ArrowRight,
} from "lucide-react";
import { cachedLeaderboard } from "@/lib/data";
import { config } from "@/lib/config";
import { homeMetadata } from "@/lib/seo";
import { withSocial } from "@/lib/social";
import { SignIn } from "@/components/actions";
import { Ranking } from "@/components/ranking";
import { Ad } from "@/components/ad";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return withSocial(homeMetadata());
}
export default async function Home() {
  const env = config();
  const result = await cachedLeaderboard(7, "").catch(() => null);
  return (
    <>
      <section className="hero">
        <div>
          <div className="eyebrow">
            <span className="status-dot" />
            THE PUBLIC SCOREBOARD FOR BUILDERS
          </div>
          <h1>
            Your work.
            <br />
            Out in the <span className="lime">open.</span>
          </h1>
          <p className="hero-description">
            You build with agents. Let your progress speak.
            <br />
            Turn your public GitHub activity into a profile worth sharing.
          </p>
          <div className="hero-actions">
            <SignIn
              configured={Boolean(env.GITHUB_CLIENT_ID)}
              label="Claim your profile"
            />
            <Link className="button button-ghost" href="/leaderboard">
              Explore the board <ArrowUpRight size={16} />
            </Link>
          </div>
          <p className="hero-note">
            <ShieldCheck size={13} /> Free to join. Public activity only. Your
            account, verified.
          </p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="signal-card">
            <div className="signal-top mono">
              <span>YOUR NEXT CHAPTER</span>
              <GitCommitHorizontal size={15} />
            </div>
            <div className="signal-number">
              ship<span className="text-white">.</span>
            </div>
            <div className="signal-chart">
              {[17, 28, 22, 40, 27, 46, 36, 52, 44, 60, 49, 65].map((v, i) => (
                <i key={i} style={{ height: v }} />
              ))}
            </div>
            <div className="signal-bottom mono">
              <span>CONNECT. BUILD. REPEAT.</span>
              <ArrowUpRight size={13} />
            </div>
          </div>
          <div className="signal-label mono">✦ HUMAN-LED. AGENT-POWERED.</div>
        </div>
      </section>
      <div className="ecosystem">
        <span>HOWEVER YOU BUILD</span>
        <strong>Claude Code</strong>
        <strong>⌘ Codex</strong>
        <strong>Cursor</strong>
        <strong>Grok</strong>
        <strong>GitHub Copilot</strong>
        <Link href="/agents" className="text-link">
          Bring your agent <ArrowRight size={13} />
        </Link>
      </div>
      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow">
              <span className="status-dot" />
              THE BUILDERS BOARD
            </div>
            <h2>Less talk. More shipped.</h2>
          </div>
          <div className="periods">
            <Link className="selected" href="/leaderboard?period=7">
              7 DAYS
            </Link>
            <Link href="/leaderboard?period=30">30 DAYS</Link>
          </div>
        </div>
        <Ad />
        {result ? (
          <Ranking entries={result.entries.slice(0, 7)} compact />
        ) : (
          <div className="panel">
            <p>
              Activity is temporarily unavailable. The last successful sync is
              kept safe.
            </p>
          </div>
        )}
        <p className="subtle text-[11px] mt-4 flex gap-2 items-center">
          <GitCommitHorizontal size={13} />
          Public commits, pull requests, issues and reviews. Ranked among
          participating builders.
        </p>
      </section>
      <div className="principles">
        <div className="principle">
          <ShieldCheck size={22} />
          <h3>Proof starts with identity.</h3>
          <p>
            Your profile is linked to the GitHub account you control. Every
            number has a clear definition.
          </p>
        </div>
        <div className="principle">
          <Bot size={22} />
          <h3>Let your agent handle it.</h3>
          <p>
            Send your bot one link. It can start registration and bring you back
            when authorization is needed.
          </p>
        </div>
        <div className="principle">
          <Terminal size={22} />
          <h3>Built for the public internet.</h3>
          <p>
            A shareable profile, transparent ranking and open source. Make your
            progress easy to discover.
          </p>
        </div>
      </div>
    </>
  );
}
