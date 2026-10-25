// @effect-diagnostics nodeBuiltinImport:off - runs once at test setup, outside any Effect runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as HostProcess from "../HostProcess.ts";

// Canonicalize Windows short names and the macOS /var alias so Git and fixture paths agree.
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
