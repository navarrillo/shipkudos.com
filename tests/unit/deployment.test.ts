import { afterEach, describe, it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, spawn } from "node:child_process";
const dirs: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "shipkudos-ops-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "state"));
  mkdirSync(join(dir, "uploads"));
  const old = "a".repeat(40),
    next = "b".repeat(40),
    repo = "ghcr.io/example/shipkudos",
    log = join(dir, "commands.log");
  writeFileSync(
    join(dir, "state", "releases.json"),
    JSON.stringify({
      history: [{ sha: old, image: repo + "@sha256:" + "a".repeat(64) }],
    }),
  );
  writeFileSync(join(dir, "running"), old);
  writeFileSync(
    join(dir, ".env"),
    `STATE_DIR=${dir}/state\nUPLOADS_DIR=${dir}/uploads\nIMAGE_REPO=${repo}\nDEPLOY_READY_TIMEOUT=1\nLOCK_TIMEOUT=0\n`,
  );
  writeFileSync(
    join(dir, "bin", "docker"),
    `#!/usr/bin/env bash\nset -eu\nprintf '%s | %s\\n' "$*" "${"$"}{APP_SHA:-}" >> "$STUB_DIR/commands.log"\nif [[ "$1" == pull ]];then [[ "${"$"}{FAIL_PULL:-0}" != 1 ]];exit;fi\nif [[ "$1 $2" == 'image inspect' ]];then echo "docker.io/library/another-tag@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";echo "$IMAGE_REPO@sha256:${"b".repeat(64)}";exit;fi\nif [[ "$*" == *'ps --status running --services'* ]];then echo postgres;exit;fi\nif [[ "$*" == *'run --rm -T --no-deps migrate'* ]];then if [[ "${"$"}{HOLD_MIGRATION:-0}" == 1 ]];then /bin/sleep 1;fi;[[ "${"$"}{FAIL_MIGRATION:-0}" != 1 ]];exit;fi\nif [[ "$*" == *'--force-recreate web worker'* ]];then printf '%s' "$APP_SHA" > "$STUB_DIR/running";fi\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, "bin", "curl"),
    `#!/usr/bin/env python3\nimport os,json,sys\nsha=open(os.environ['STUB_DIR']+'/running').read()\nif os.environ.get('FAIL_TARGET')==sha: sys.exit(22)\nprint(json.dumps({'status':'ok','release':sha,'workerRelease':sha}))\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, "bin", "sleep"),
    "#!/usr/bin/env bash\n/bin/sleep 0.02\n",
    { mode: 0o755 },
  );
  if (process.platform === "darwin")
    writeFileSync(
      join(dir, "bin", "flock"),
      "#!/usr/bin/env python3\nimport fcntl,sys\ntry: fcntl.flock(int(sys.argv[-1]),fcntl.LOCK_EX|fcntl.LOCK_NB)\nexcept BlockingIOError: sys.exit(1)\n",
      { mode: 0o755 },
    );
  const env = {
    ...process.env,
    ENV_FILE: join(dir, ".env"),
    STUB_DIR: dir,
    PATH: join(dir, "bin") + ":" + process.env.PATH,
  };
  const run = (script: string, extra: Record<string, string> = {}) =>
    spawnSync(
      "bash",
      [resolve("bin/" + script), ...(script === "deploy" ? [next] : [])],
      { env: { ...env, ...extra }, encoding: "utf8", timeout: 12000 },
    );
  return {
    dir,
    old,
    next,
    env,
    log,
    run,
    state: () =>
      JSON.parse(readFileSync(join(dir, "state", "releases.json"), "utf8")),
    commands: () => readFileSync(log, "utf8"),
  };
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
describe("release recovery", () => {
  it("migrates once, recreates only app services and commits a healthy image", () => {
    const f = fixture(),
      r = f.run("deploy");
    expect(r.status, r.stderr).toBe(0);
    expect(f.state().history.at(-1).sha).toBe(f.next);
    expect(f.state().history.at(-1).image).toBe(
      "ghcr.io/example/shipkudos@sha256:" + "b".repeat(64),
    );
    expect(
      f
        .commands()
        .split("\n")
        .filter((l) => l.includes("run --rm -T --no-deps migrate")),
    ).toHaveLength(1);
    expect(f.commands()).not.toContain("down");
    expect(f.commands()).not.toContain("up -d --no-deps postgres");
    expect(f.commands()).toContain(
      `pull ghcr.io/example/shipkudos:${f.next} |`,
    );
    expect(f.commands()).not.toContain("development-");
  });
  it("pulls the channel tag and refuses production tag names", () => {
    const f = fixture();
    const deployed = f.run("deploy", { IMAGE_CHANNEL: "development" });
    expect(deployed.status, deployed.stderr).toBe(0);
    expect(f.commands()).toContain(
      `pull ghcr.io/example/shipkudos:development-${f.next} |`,
    );
    expect(f.commands()).not.toContain(
      `pull ghcr.io/example/shipkudos:${f.next} |`,
    );
    expect(f.run("deploy", { IMAGE_CHANNEL: "latest" }).status).toBe(2);
    expect(f.run("deploy", { IMAGE_CHANNEL: "v1.2.3" }).status).toBe(2);
  });
  it("pull failure keeps the running release and never migrates", () => {
    const f = fixture();
    expect(f.run("deploy", { FAIL_PULL: "1" }).status).not.toBe(0);
    expect(f.state().history.at(-1).sha).toBe(f.old);
    expect(f.commands()).not.toContain(" migrate");
  });
  it("migration failure leaves existing application images intact", () => {
    const f = fixture();
    expect(f.run("deploy", { FAIL_MIGRATION: "1" }).status).not.toBe(0);
    expect(f.commands()).not.toContain("--force-recreate");
    expect(f.state().history.at(-1).sha).toBe(f.old);
  });
  it("failed readiness recovers only the last app image and still returns failure", () => {
    const f = fixture();
    expect(f.run("deploy", { FAIL_TARGET: f.next }).status).not.toBe(0);
    expect(readFileSync(join(f.dir, "running"), "utf8")).toBe(f.old);
    expect(f.state().history).toHaveLength(1);
    expect(f.commands()).not.toContain("pg_restore");
    expect(f.commands()).not.toContain("down");
  });
  it("manual rollback does not migrate or pull another database image", () => {
    const f = fixture();
    expect(f.run("deploy").status).toBe(0);
    writeFileSync(f.log, "");
    expect(f.run("rollback").status).toBe(0);
    expect(f.state().history.at(-1).sha).toBe(f.old);
    expect(f.commands()).not.toContain("migrate");
    expect(f.commands()).not.toContain("postgres");
  });
  it("serializes maintenance with the same lock file", async () => {
    const f = fixture();
    const first = spawn("bash", [resolve("bin/deploy"), f.next], {
      env: { ...f.env, HOLD_MIGRATION: "1" },
      stdio: "ignore",
    });
    await new Promise((r) => setTimeout(r, 200));
    const second = f.run("deploy");
    expect(second.status).not.toBe(0);
    await new Promise<void>((r) => first.on("exit", () => r()));
  });
});
