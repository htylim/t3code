// @effect-diagnostics nodeBuiltinImport:off -- This CLI owns Playwright resources outside an Effect runtime.
import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";

import * as NodeChildProcess from "node:child_process";
import * as NodeTimersPromises from "node:timers/promises";
import { ServerBrowserContexts } from "../src/preview/ServerBrowserContexts.ts";
import * as capture from "../src/preview/ServerBrowserPage.ts";
// Run from the repository root. Pair only with its isolated development state.
const [originArgument, outputDirectory, chromeExecutable] = process.argv.slice(2);
if (
  !originArgument ||
  !outputDirectory ||
  !chromeExecutable ||
  !NodePath.isAbsolute(outputDirectory) ||
  !NodePath.isAbsolute(chromeExecutable)
) {
  throw new Error(
    "Usage: capture-dev-ui.mts <loopback-origin> <absolute-output-directory> <absolute-chrome-headless-shell>",
  );
}
const origin = new URL(originArgument);
if (
  origin.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
) {
  throw new Error(
    "Use only the isolated dev server HTTP loopback origin, without a path or credentials.",
  );
}
const repositoryRoot = process.cwd();
const baseDir = NodePath.join(repositoryRoot, ".t3");
if ((await NodeFSP.realpath(baseDir)) !== baseDir)
  throw new Error("The development home must not be a symlink.");
await NodeFSP.mkdir(outputDirectory, { recursive: true });
const contexts = new ServerBrowserContexts({
  profilesDir: outputDirectory + "/headless-profile",
  executable: async () => chromeExecutable,
});
try {
  const context = await contexts.contextFor("incognito");
  const page = await context.newPage();
  const pairingOutput = NodeChildProcess.execFileSync(
    process.execPath,
    [
      repositoryRoot + "/apps/server/src/bin.ts",
      "pair",
      "--base-dir",
      baseDir,
      "--label",
      "headless-audit",
    ],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 30_000 },
  );
  const token = /#token=([A-Z2-9]+)/.exec(pairingOutput)?.[1];
  if (!token) throw new Error("The isolated server did not issue a pairing token.");
  await page.goto(origin.origin + "/pair#token=" + token);
  await page.getByRole("combobox", { name: "Search threads", exact: true }).waitFor();
  await page.goto(origin.origin + "/settings/fork");
  await page.getByRole("heading", { name: "Interface", exact: true }).waitFor();
  await page.evaluate("document.fonts.ready");
  const cdp = await context.newCDPSession(page);
  const snapshot = await capture.snapshot({
    page,
    cdp,
    renderScale: 2,
    consoleEntries: [],
    networkEntries: [],
    actionTimeline: [],
  });
  await NodeFSP.writeFile(
    outputDirectory + "/headless-snapshot.png",
    Buffer.from(snapshot.screenshot.data, "base64"),
  );
  await page.screenshot({ path: outputDirectory + "/headless-native.png" });
  const encoder = await contexts.scratchPage();
  await encoder.evaluate(capture.recordingEncoderScript(30));
  const pendingFrames = new Set<Promise<void>>();
  cdp.on("Page.screencastFrame", (frame) => {
    const pending = encoder
      .evaluate<boolean>(`globalThis.__t3Recorder.frame(${JSON.stringify(frame.data)}, 1280)`)
      .then(() => {})
      .finally(() => {
        pendingFrames.delete(pending);
        void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
      });
    pendingFrames.add(pending);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
  // Deliberate viewing time for the recording, after the UI readiness checks.
  await NodeTimersPromises.setTimeout(1500);
  await page.getByRole("treeitem", { name: "General", exact: true }).click();
  await page
    .getByRole("treeitem", { name: "General", exact: true })
    .and(page.locator('[aria-selected="true"]'))
    .waitFor();
  await page.screenshot({ path: outputDirectory + "/headless-general.png" });
  // Deliberate viewing time for the recording, after the UI readiness checks.
  await NodeTimersPromises.setTimeout(1500);
  await page.getByRole("treeitem", { name: "Fork", exact: true }).click();
  await page.getByRole("heading", { name: "Interface", exact: true }).waitFor();
  await page.screenshot({ path: outputDirectory + "/headless-after-navigation.png" });
  // Deliberate viewing time for the recording, after the UI readiness checks.
  await NodeTimersPromises.setTimeout(1500);
  await cdp.send("Page.stopScreencast");
  await Promise.all(pendingFrames);
  const recordingResult = await encoder.evaluate<{
    mimeType: string;
    count: number;
    bytes: number;
  }>("globalThis.__t3Recorder.stop()");
  const videoChunks = [];
  for (let index = 0; index < recordingResult.count; index++)
    videoChunks.push(
      Buffer.from(
        await encoder.evaluate<string>(`globalThis.__t3Recorder.chunk(${index})`),
        "base64",
      ),
    );
  await NodeFSP.writeFile(outputDirectory + "/headless-recording.mp4", Buffer.concat(videoChunks));
  await NodeFSP.writeFile(
    outputDirectory + "/headless-result.json",
    JSON.stringify(
      {
        viewport: await page.evaluate(
          "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})",
        ),
        screenshot: { width: snapshot.screenshot.width, height: snapshot.screenshot.height },
        recording: recordingResult,
      },
      null,
      2,
    ),
  );
  process.stdout.write("Headless screenshot and recording completed.\n");
} finally {
  await contexts.close();
}
