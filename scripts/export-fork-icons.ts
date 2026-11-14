#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import sharp from "sharp";

import { BRAND_ASSET_PATHS } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

/** Rasterize the fork SVG at the destination size without an intermediate bitmap. */
const renderPng = Effect.fn("forkIcons.renderPng")(function* (svg: string, size: number) {
  return yield* Effect.promise(() =>
    sharp(Buffer.from(svg), { density: 300 }).resize(size, size).png().toBuffer(),
  );
});

/** Export only fork assets; upstream icons and runtime identities remain unchanged. */
export const exportForkIcons = Effect.fn("forkIcons.export")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repositoryRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const mark = yield* fs.readFileString(path.join(repositoryRoot, BRAND_ASSET_PATHS.forkMarkSvg));
  const markBody = mark.replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  const flatSvg = mark.replace(
    /(<svg[^>]*>)/,
    '$1<rect width="128" height="128" rx="26" fill="black"/>',
  );
  const macBackground = yield* fs.readFileString(
    path.join(repositoryRoot, BRAND_ASSET_PATHS.forkMacBackgroundSvg),
  );
  const macSvg = macBackground.replace(
    /<\/svg>\s*$/,
    `<g transform="translate(74.666667 74.666667) scale(6.833333)">${markBody.replace('fill="white"', 'fill="url(#metal)"')}</g></svg>`,
  );
  const pngOutputs = [
    [BRAND_ASSET_PATHS.forkLinuxIconPng, 1024],
    [BRAND_ASSET_PATHS.forkWebAppleTouchIconPng, 180],
    [BRAND_ASSET_PATHS.forkWebIcon192Png, 192],
    [BRAND_ASSET_PATHS.forkWebIcon512Png, 512],
    [BRAND_ASSET_PATHS.forkWebFavicon16Png, 16],
    [BRAND_ASSET_PATHS.forkWebFavicon32Png, 32],
  ] as const;
  for (const [relativePath, size] of pngOutputs) {
    yield* fs.writeFile(path.join(repositoryRoot, relativePath), yield* renderPng(flatSvg, size));
  }
  yield* fs.writeFile(
    path.join(repositoryRoot, BRAND_ASSET_PATHS.forkMacIconPng),
    yield* renderPng(macSvg, 1024),
  );
  const icoImages = yield* Effect.forEach(WINDOWS_ICON_SIZES, (size) =>
    renderPng(flatSvg, size).pipe(Effect.map((contents) => ({ size, contents }))),
  );
  const ico = encodePngIco(icoImages);
  for (const relativePath of [
    BRAND_ASSET_PATHS.forkWindowsIconIco,
    BRAND_ASSET_PATHS.forkWebFaviconIco,
  ]) {
    yield* fs.writeFile(path.join(repositoryRoot, relativePath), ico);
  }
  yield* fs.writeFileString(path.join(repositoryRoot, "assets/fork/h3-macos.svg"), macSvg);
  yield* fs.writeFileString(path.join(repositoryRoot, "assets/fork/h3-flat.svg"), flatSvg);
  yield* Console.log("Exported H3 Code SVG, PNG, and ICO assets.");
});

if (import.meta.main) {
  exportForkIcons().pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
