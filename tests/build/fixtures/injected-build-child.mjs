import rspack from "@rspack/core";
import { runBuildCommand } from "../../../scripts/build/pipeline.mjs";

const phase = process.env.NO_MORE_AGO_INJECT_PHASE;
const hold = (milliseconds = 250) => {
  if (!phase) return;
  const until = Date.now() + milliseconds;
  while (Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
};
const events = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
await runBuildCommand({
  workspaceRoot: process.cwd(), mode: "dev", argv: ["chrome", "--watch"],
  compilerFactory: (config) => { events({ type: "build-pid", pid: process.pid }); if (phase === "compile") hold(); return rspack(config); }, events,
  phaseHooks: { beforePackage: () => { if (phase === "package") hold(); if (phase === "rapid") hold(120); }, beforePublish: () => { if (phase === "promotion") hold(); }, afterCleanup: () => { if (phase === "post-cleanup") hold(); } }
});
