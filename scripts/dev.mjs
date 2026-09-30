// One command: build the page agent, start the mock backend, serve the host app.

// Vite needs Node 20.19+ or 22.12+, and Vitest 22.12+. Say so plainly instead
// of failing somewhere inside a dependency.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Vitrine needs Node 22.12 or later; this is Node ${process.versions.node}. Try: nvm use 24`);
  process.exit(1);
}
// Loaded only after the check above: static imports would run first.
const { spawn } = await import("node:child_process");
const { context } = await import("esbuild");
const { createServer } = await import("vite");

// The agent is the one <script> each page loads. It is bundled into the pages
// directory so it is served from the pages' own origin.
const agent = await context({
  entryPoints: ["frontend/src/agent/index.ts"],
  outfile: "backend/pages/figr-agent.js",
  bundle: true,
  format: "iife",
  target: "es2020",
  logLevel: "warning",
});
await agent.rebuild();
await agent.watch();

const backend = spawn(process.execPath, ["backend/server.js"], { stdio: "inherit" });

const server = await createServer();
await server.listen();
console.log("Board  → http://localhost:4002");

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  backend.kill();
  await Promise.allSettled([server.close(), agent.dispose()]);
  process.exit(code);
}
backend.on("exit", (code) => shutdown(code ?? 1));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
