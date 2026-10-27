import type { Metadata } from "next";
import Link from "next/link";
import { Command, ArrowUpRight } from "lucide-react";
import { config } from "@/lib/config";
import { rootMetadata } from "@/lib/seo";
import "./globals.css";
export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  return rootMetadata();
}
export default function Layout({ children }: { children: React.ReactNode }) {
  const name = config().APP_NAME;
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip">
          Skip to content
        </a>
        <div className="shell">
          <header className="nav">
            <Link className="brand" href="/">
              <span className="brand-mark">
                <Command size={20} />
              </span>
              {name}
              <span className="mono subtle text-[9px] ml-1">BETA</span>
            </Link>
            <nav className="nav-links" aria-label="Main">
              <Link href="/leaderboard">Leaderboard</Link>
              <Link href="/agents">For agents</Link>
              <Link href="/advertise" className="secondary">
                Advertise
              </Link>
            </nav>
            <div className="nav-end">
              <Link
                className="button button-outline button-small"
                href="/dashboard"
              >
                Your profile <ArrowUpRight size={13} />
              </Link>
            </div>
          </header>
          <main id="main">{children}</main>
          <footer className="footer">
            <span>
              © {new Date().getFullYear()} {name} · Built in public. Measured in
              progress.
            </span>
            <div className="footer-links">
              <Link href="/methodology">Methodology</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <a
                href="https://github.com/navarrillo/shipkudos.com"
                target="_blank"
                rel="noopener"
              >
                Source ↗
              </a>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
