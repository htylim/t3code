// @effect-diagnostics nodeBuiltinImport:off - runs once at test setup, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as HostProcess from "../HostProcess.ts";

// Windows runners may use an 8.3 short path, and macOS exposes /var through
// /private/var. Use the canonical temporary root so Git and realpath agree
// with the fixture paths. Explicit symlink fixtures still exercise aliases.
const platform = HostProcess.Platform.defaultValue();
if (platform === "win32" || platform === "darwin") {
  try {
    const canonicalTempDirectory = NodeFS.realpathSync.native(NodeOS.tmpdir());
    if (platform === "win32") {
      process.env.TEMP = canonicalTempDirectory;
      process.env.TMP = canonicalTempDirectory;
    } else {
      process.env.TMPDIR = canonicalTempDirectory;
    }
  } catch {}
}
