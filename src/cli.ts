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

await import("./cli-main.js");
