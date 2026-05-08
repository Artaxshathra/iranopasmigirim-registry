// Build: bundle the SW + popup with esbuild, then stage the per-target
// manifest, popup HTML/CSS, and icons into dist/<target>/.
//
// One bundle for the SW (background.js), one for the popup (popup.js).
// We bundle rather than ship modules-as-files because Firefox MV2 background
// scripts can't be type:module without polyfills, and a bundle works
// identically on both targets.

import * as esbuild from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));

const TARGETS = {
  chrome:  { manifest: 'manifest.json',         out: 'dist/chrome'  },
  firefox: { manifest: 'manifest_firefox.json', out: 'dist/firefox' },
};

async function buildOne(target) {
  const cfg = TARGETS[target];
  if (!cfg) throw new Error(`unknown target: ${target}`);
  const out = path.join(ROOT, cfg.out);

  // Clean the output dir so a removed source file doesn't linger in the
  // bundle. We'd rather rebuild from scratch every time than chase a
  // stale-cache bug.
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(path.join(out, 'popup'), { recursive: true });
  await fs.mkdir(path.join(out, 'icons'), { recursive: true });

  // Bundle the service worker / background script.
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/background/service-worker.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome102', 'firefox115'],
    outfile: path.join(out, 'background.js'),
    minify: false,                // keep readable for review; total size is small
    sourcemap: true,
    legalComments: 'inline',
  });

  // Bundle the popup script (it imports config.js).
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/popup/popup.js')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome102', 'firefox115'],
    outfile: path.join(out, 'popup/popup.js'),
    sourcemap: true,
    legalComments: 'inline',
  });

  // Stage the manifest.
  await fs.copyFile(path.join(ROOT, cfg.manifest), path.join(out, 'manifest.json'));

  // Stage popup HTML + CSS verbatim — esbuild doesn't process them.
  await fs.copyFile(
    path.join(ROOT, 'src/popup/popup.html'),
    path.join(out, 'popup/popup.html'),
  );
  await fs.copyFile(
    path.join(ROOT, 'src/popup/popup.css'),
    path.join(out, 'popup/popup.css'),
  );

  // Icons. The icons/ folder is optional during early dev — copy what
  // exists, warn for what's missing.
  const iconsSrc = path.join(ROOT, 'icons');
  try {
    const entries = await fs.readdir(iconsSrc);
    for (const f of entries) {
      await fs.copyFile(path.join(iconsSrc, f), path.join(out, 'icons', f));
    }
  } catch (_) {
    console.warn(`[build:${target}] no icons/ folder yet — skipped`);
  }

  // Read manifest back to surface the version + name in the build log.
  const m = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'));
  console.log(`[build:${target}] ${m.name} v${m.version} → ${cfg.out}/`);
}

async function main() {
  const arg = process.argv[2] || 'both';
  if (arg === 'both') {
    await buildOne('chrome');
    await buildOne('firefox');
  } else {
    await buildOne(arg);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
