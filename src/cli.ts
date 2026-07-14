#!/usr/bin/env node
import { checkNodeVersion, formatNodeVersionError } from "@/lib/node-version";

const nodeVersion = checkNodeVersion(process.version);

// The package's engine applies to every CLI path, including --help/--version.
// Keep this before the Ink runtime import so unsupported Node versions get a
// plain stderr message instead of dependency/runtime failures.
if (!nodeVersion.ok) {
  process.stderr.write(`${formatNodeVersionError(nodeVersion)}\n`);
  process.exit(1);
}

const { runCli } = await import("./cli-runtime.js");
await runCli();
