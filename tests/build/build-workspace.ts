import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";

export type BuildEvent = Record<string, unknown> & { type?: string; status?: string; sequence?: number; pid?: number };

export function makeWorkspace(sourceRoot = process.cwd()): string {
  const workspace = mkdtempSync(path.join(tmpdir(), "no-more-ago-build-"));
  for (const name of ["package.json", "pnpm-lock.yaml", "rspack.config.mjs", "Makefile", "tsconfig.json", "vitest.config.ts", "eslint.config.mjs"]) {
    cpSync(path.join(sourceRoot, name), path.join(workspace, name));
  }
  cpSync(path.join(sourceRoot, "src"), path.join(workspace, "src"), { recursive: true });
  cpSync(path.join(sourceRoot, "scripts"), path.join(workspace, "scripts"), { recursive: true });
  mkdirSync(path.join(workspace, "tests/build"), { recursive: true }); cpSync(path.join(sourceRoot, "tests/build/fixtures"), path.join(workspace, "tests/build/fixtures"), { recursive: true });
  const modules = path.join(workspace, "node_modules");
  // Tests use the already-installed dependency tree and never invoke a package-manager install.
  symlinkSync(path.join(sourceRoot, "node_modules"), modules, "junction");
  return workspace;
}

export function removeWorkspace(workspace: string): void {
  if (workspace.includes("no-more-ago-build-")) rmSync(workspace, { recursive: true, force: true });
}

export function hashPath(file: string): string {
  const hash = createHash("sha256");
  const visit = (current: string): void => {
    const stat = statSync(current);
    if (stat.isDirectory()) for (const name of readdirSync(current).sort()) { hash.update(name); visit(path.join(current, name)); }
    else hash.update(readFileSync(current));
  };
  visit(file);
  return hash.digest("hex");
}

export function artifactBytes(root: string): string[] {
  const names: string[] = [];
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const file = path.join(current, name);
      if (statSync(file).isDirectory()) visit(file);
      else names.push(path.relative(root, file).split(path.sep).join("/"));
    }
  };
  visit(root);
  return names;
}

export interface RunningBuild {
  child: ReturnType<typeof spawn>;
  events: BuildEvent[];
  waitFor(predicate: (event: BuildEvent) => boolean, timeoutMs?: number): Promise<BuildEvent>;
  stop(readyPid?: number, timeoutMs?: number): Promise<void>;
}

async function boundedStop(child: ReturnType<typeof spawn>, exited: Promise<void>, stdoutClosed: Promise<void>, stderrClosed: Promise<void>, readyPid: number | undefined, timeoutMs: number): Promise<void> {
  const signalPid = readyPid ?? child.pid;
  if (signalPid !== undefined) { try { process.kill(signalPid, "SIGTERM"); } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error; } }
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  const wrapperPid = child.pid;
  if (child.exitCode === null && process.platform !== "win32" && wrapperPid !== undefined) { try { process.kill(-wrapperPid, "SIGKILL"); } catch { /* already exited */ } }
  if (child.exitCode === null) child.kill("SIGKILL");
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
  if (signalPid !== undefined) await waitForPidGone(signalPid, timeoutMs);
  if (wrapperPid !== undefined) await waitForPidGone(wrapperPid, timeoutMs);
  if (child.stdout) child.stdout.destroy(); if (child.stderr) child.stderr.destroy();
  await Promise.race([Promise.all([stdoutClosed, stderrClosed]), new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))]);
}

export function startBuild(workspace: string, args: string[], environment: NodeJS.ProcessEnv = process.env): RunningBuild {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, args, { cwd: workspace, env: environment, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" }) as unknown as ChildProcessWithoutNullStreams;
  const stdout = child.stdout; const stderr = child.stderr;
  const exited = new Promise<void>((resolve) => { child.once("exit", () => { resolve(); }); }); const stdoutClosed = new Promise<void>((resolve) => { stdout.once("close", () => { resolve(); }); }); const stderrClosed = new Promise<void>((resolve) => { stderr.once("close", () => { resolve(); }); });
  const events: BuildEvent[] = [];
  let output = "";
  stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    const lines = output.split("\n"); output = lines.pop() ?? "";
    for (const line of lines) { try { const event = JSON.parse(line) as BuildEvent; events.push(event); } catch { /* package-manager diagnostics are not events */ } }
  });
  const waitFor = (predicate: (event: BuildEvent) => boolean, timeoutMs = 20_000): Promise<BuildEvent> => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const event = events.find(predicate);
      if (event) { clearInterval(timer); resolve(event); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error(`Timed out waiting for build event: ${JSON.stringify(events)}`)); }
    }, 25);
  });
  let stopping: Promise<void> | undefined;
  const stop = (readyPid?: number, timeoutMs = 5_000): Promise<void> => { stopping ??= boundedStop(child, exited, stdoutClosed, stderrClosed, readyPid, timeoutMs); return stopping; };
  return { child, events, waitFor, stop };
}

export function startInjectedBuild(workspace: string, phase: string): RunningBuild {
  const packagePath = path.join(workspace, "package.json"); const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { scripts: Record<string, string> }; packageJson.scripts.dev = "node tests/build/fixtures/injected-build-child.mjs"; writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"; const child = spawn(command, ["dev", "chrome", "--watch"], { cwd: workspace, env: { ...process.env, NO_MORE_AGO_INJECT_PHASE: phase }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" }) as unknown as ChildProcessWithoutNullStreams;
  const stdout = child.stdout; const stderr = child.stderr;
  const events: BuildEvent[] = []; let output = ""; const exited = new Promise<void>((resolve) => { child.once("exit", () => { resolve(); }); }); const stdoutClosed = new Promise<void>((resolve) => { stdout.once("close", () => { resolve(); }); }); const stderrClosed = new Promise<void>((resolve) => { stderr.once("close", () => { resolve(); }); });
  stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); const lines = output.split("\n"); output = lines.pop() ?? ""; for (const line of lines) { try { events.push(JSON.parse(line) as BuildEvent); } catch { /* diagnostics */ } } });
  const waitFor = (predicate: (event: BuildEvent) => boolean, timeoutMs = 20_000): Promise<BuildEvent> => new Promise((resolve, reject) => { const start = Date.now(); const timer = setInterval(() => { const event = events.find(predicate); if (event) { clearInterval(timer); resolve(event); } else if (Date.now() - start > timeoutMs) { clearInterval(timer); reject(new Error(`Timed out waiting for fixture event: ${JSON.stringify(events)}`)); } }, 25); });
  let stopping: Promise<void> | undefined;
  const stop = (readyPid?: number, timeoutMs = 5_000): Promise<void> => { stopping ??= boundedStop(child, exited, stdoutClosed, stderrClosed, readyPid, timeoutMs); return stopping; };
  return { child, events, waitFor, stop };
}

export async function waitForPidGone(pid: number, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { try { process.kill(pid, 0); } catch { return; } await new Promise<void>((resolve) => setTimeout(resolve, 25)); }
  throw new Error(`PID ${String(pid)} remained alive after ${String(timeoutMs)}ms`);
}

export function hasNoBuildResidue(workspace: string): boolean {
  const dist = path.join(workspace, "dist");
  return !existsSync(dist) || readdirSync(dist).every((name) => !name.startsWith(".task-") && !name.startsWith(".candidate-"));
}
