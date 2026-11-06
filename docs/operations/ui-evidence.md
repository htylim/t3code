# Launch and capture isolated UI evidence

Use this procedure with [test-t3-app](../../.agents/skills/test-t3-app/SKILL.md).
Keep screenshots, recordings, logs, and copied data outside tracked source. A successful
click or accessibility snapshot does not establish that a screenshot is usable.

## Start and prove readiness

1. Inspect this checkout's setup markers and existing dev session. Reuse a healthy server.
   Otherwise run `vp run dev` from the absolute worktree root and retain its terminal session.
   Redirect output to a private log outside the repository if needed. Do not detach it with
   `nohup`, start a second copy, or assume it survives a restart of the T3 hosting the agent.
2. Read `baseDir`, `serverPort`, and `webPort` from the new `[dev-runner]` line. A directory
   rename changes the derived ports. Confirm the home is this checkout's `.t3`, never live userdata.
   Never set `VITE_HTTP_URL` or `VITE_WS_URL`.
3. Wait for the backend's `Listening on` line. Vite's `ready` line comes earlier and does not
   prove the backend is listening. Fetch `http://127.0.0.1:<webPort>/.well-known/t3/environment`
   through Vite and verify its environment identity. Then pair the browser at the web origin.
   Initial `ECONNREFUSED` proxy errors before backend readiness are startup timing, not a pairing defect.
4. Use meaningful stopped-thread data. If automatic seeding declines a database over its size
   limit, stop only your dev session and run `vp run migrate-dev-db --projects 3 --threads-per-project 8`.
   Start again and reread the ports. Copied paths can still name real repositories. Use a disposable
   project for filesystem changes and disable cleanup in the isolated environment through Settings.
5. Configure provider/model choices through the app or typed settings API. Do not guess JSON
   shapes. For example, model options use `{ id: "reasoningEffort", value: "low" }`, not a
   free-form map. A `failed to parse settings.json, using defaults` warning invalidates assumptions
   about the selected account or model. Repair and verify before any provider turn.

After cancellation or a host restart, treat the old background session as lost until checked.
Probe the recorded web origin, inspect the log and session, then start again only if needed.
Stop only a retained session or a PID captured when you launched it. Never kill by process pattern.

## Acquire and pair a browser

Call `preview_status` first. If there is no usable tab, call `preview_open`; `available:false`
with `tabId:null` can simply mean no tab exists. It is not a request for the maintainer to reopen
the panel. Retain the returned tab ID and pass it explicitly after creating another tab.

For isolated testing, prefer a new tab with `profileId:"incognito"` and `reuseExistingTab:false`.
Pair using the fresh startup link. If it was consumed or expired, mint another with
`node apps/server/src/bin.ts pair --base-dir <absolute-worktree>/.t3`. Keep its token private and
use the web origin, not the backend origin. Verify the final route leaves `/pair` and a real UI
locator appears, such as the combobox named `Search threads`. Waiting for visible text `Search`
is insufficient when that word is only an input placeholder or accessible name.

An HTTP 431 after pairing can mean the default browser profile has too many localhost cookies.
Cookies are shared across ports. A fresh incognito profile resolved this in the November 6 audit.
Do not clear the maintainer's normal profile or weaken authentication to work around it.

## Capture and inspect originals

Set an explicit viewport, then read back `innerWidth`, `innerHeight`, `devicePixelRatio`, and
font readiness. Resize replies can briefly contain the previous viewport. Await the affected
control or content rather than sleeping for an assumed load time. Take a new snapshot after
navigation before using its locators.

Use `preview_snapshot` with `save:true` and inspect the saved PNG itself at native size.
The snapshot API caps width at 1280 pixels, so a 1440 CSS-pixel viewport can lose text detail.
Use 1280 by 800 for the first desktop calibration and smaller viewports for narrow layouts.
Check small body text, icons, dialog contents, and the exact region the change affects.

Retain originals. A report may contain thumbnails for navigation, but every thumbnail must open
the original PNG. Do not recompress proof into JPEG, enlarge a thumbnail, sharpen a blurred image,
or count DOM text as proof that missing screenshot text was rendered. Match before and after
viewport, theme, scroll position, and device-local preferences. Label intentional backdrop blur
separately from unreadable foreground text.

If controls work but capture times out, reacquire status and try once after navigation or reopening
the test tab. Ask the maintainer to reopen the whole panel only when that recovery is actually
needed. Reopening the panel has recovered timeouts, but did not establish a cure for blurred text.

## Headless fallback for blurred desktop-backed capture

The November 6 audit reproduced blurred original PNGs and video frames through desktop-backed
Browser captures. The same page was sharp in independent Chrome and in T3's headless renderer.
Desktop-backed capture reported DPR 1; the tested headless context reported DPR 2. The exact
Electron/compositor cause remains unresolved. Do not claim a capture-engine fix from this result.

`runtime:"server"` in the tab listing does not prove headless rendering: the server can attach
to an Electron page. Opening another tab, `open:false`, reducing viewport width, and temporarily
removing backdrop blur did not fix this instance. Do not disable product CSS for review evidence.

After repeated unusable captures, use the repository's headless calibration helper. It uses
`ServerBrowserContexts`, `ServerBrowserPage.snapshot`, and T3's video encoder directly. It does
not install another automation framework or modify the running desktop app. Use it only when
the session's browser instructions permit a fallback.

From the worktree root, with the dev server ready:

```bash
node apps/server/scripts/capture-dev-ui.mts \
  http://localhost:<actual-web-port> \
  /absolute/temporary/evidence-directory \
  /absolute/path/to/chrome-headless-shell
```

Use the existing pinned executable from T3's browser installation or the repository's Playwright
cache. Do not disable the browser sandbox or install another browser to bypass a launch error.
The helper accepts only a loopback HTTP origin, authenticates against this checkout's `.t3`,
rejects a symlinked home, and closes its browser in `finally`. It visits Fork settings, records
General then Fork navigation, and saves the following:

- `headless-snapshot.png`, the normal T3 snapshot output.
- `headless-native.png` and `headless-after-navigation.png`, full-resolution captures.
- `headless-general.png`, the intermediate navigation state.
- `headless-recording.mp4` and `headless-result.json`, the recording and capture metrics.

This is a reusable launch/capture calibration, not coverage of an arbitrary product change.
For feature-specific evidence, run the actual flow in an isolated harness using these same
capture functions and real readiness locators. Preserve screenshots before making changes.

## Verify video, then hand back

For a healthy Browser path, call `preview_recording_start`, perform the short workflow, and
call `preview_recording_stop` on the same tab. Avoid credentials and unrelated data in view.
Do not resize halfway through a recording intended for before/after comparison.

Open the resulting file and inspect beginning, middle, and end frames. Verify dimensions,
duration, text readability, and that the intended actions appear. File existence and nonzero
size are insufficient. Use an available video inspector, or macOS AVFoundation when ffprobe
is absent. With AVAssetImageGenerator, set both requested-time tolerances to zero; otherwise
beginning, middle, and end requests can all return the same nearby keyframe.
The helper's 1.5-second holds are deliberate viewing time after readiness checks,
not synchronization delays in regression tests.

The audit's final headless PNG and decoded video frames were readable. The desktop-backed
recording was playable but its text was blurred, so it was rejected as visual proof.
Keep that distinction in the evidence record. Close audit-only tabs; retain the isolated dev
server while the maintainer inspects results. No live app restart or installation is required.
