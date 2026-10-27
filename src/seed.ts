import { sql, getPool } from "./db";
import { rebuildRankings } from "./lib/rankings";
if (process.env.NODE_ENV === "production" || process.env.DEMO_MODE !== "true")
  throw new Error(
    "Fixtures require NODE_ENV=test/development and DEMO_MODE=true on an isolated database",
  );
const count = Math.min(10000, Math.max(1, Number(process.argv[2] || 12)));
await sql(
  `INSERT INTO auth_user(id,name,email) SELECT 'fixture-'||i,'Fixture builder '||i,'fixture-'||i||'@example.invalid' FROM generate_series(1,$1::int)i ON CONFLICT DO NOTHING`,
  [count],
);
await sql(
  `INSERT INTO profiles(id,github_id,login,name,tools,published_at,last_sync_at,last_full_at,next_sync_at,sync_state) SELECT 'fixture-'||i,(1000000000+i)::text,'fixture-builder-'||i,'Fixture builder '||i,ARRAY['Codex','Grok'],now(),now(),now(),now()+interval '1 day','ready' FROM generate_series(1,$1::int)i ON CONFLICT DO NOTHING`,
  [count],
);
await sql(
  `INSERT INTO daily_stats(profile_id,day,commits,prs,issues,reviews) SELECT 'fixture-'||i,current_date-d,((i*7+d*3)%19),((i+d)%4),((i+d)%3),((i*3+d)%5) FROM generate_series(1,$1::int)i CROSS JOIN generate_series(0,59)d ON CONFLICT(profile_id,day) DO UPDATE SET commits=excluded.commits,prs=excluded.prs,issues=excluded.issues,reviews=excluded.reviews`,
  [count],
);
await rebuildRankings();
console.log(
  `Created ${count} clearly named development fixture builders. Never run this against production.`,
);
await getPool().end();
