/** React integration regression for PR #50 + #51. The real WorkspaceScene and
 * clock run in a browser; only GPU preparation is controlled so overlapping
 * completion can be tested deterministically without relying on GPU speed. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "playwright";

const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: "tsx",
    contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import WorkspaceScene from './src/components/studio/workspace-scene';
    import {usePlaybackClock} from './src/components/studio/playback-clock';
    import {createWorkspaceDocument, createDocument} from './src/lib/vfx-lab/ui-bridge';
    window.fixture = createDocument();
    function Review() {
      const [doc, setDoc] = useState(createWorkspaceDocument());
      const [solo, setSolo] = useState(undefined);
      window.install = setDoc; window.solo = setSolo;
      const clock = usePlaybackClock(doc.duration);
      return <main className="studio" style={{position:'relative',width:960,height:540}}>
        <WorkspaceScene doc={doc} clock={clock} solo={solo} loaded />
        <aside style={{position:'absolute',left:0,top:0,width:80,height:400}}>left</aside>
        <aside className="chat-panel" style={{position:'absolute',right:0,top:0,width:90,height:400}}>right</aside>
      </main>;
    }
    window.root = createRoot(document.getElementById('root'));
    window.root.render(<Review/>);
  `,
  },
  bundle: true,
  format: "iife",
  write: false,
  plugins: [
    {
      name: "controlled-gpu",
      setup(builder) {
        builder.onLoad({ filter: /[/\\]runtime-v2\.ts$/ }, () => ({
          loader: "js",
          contents: `
      export class VfxRuntimeV2 {
        constructor() { window.probe = this; this.installs = []; this.focuses = []; this.renders = 0; }
        setDocument(doc, options) { this.doc = doc; this.installs.push({name:doc.name, options}); }
        whenReady() { return this.job ??= new Promise(resolve => { this.finish = () => { this.job = null; resolve(); }; }); }
        resize() {}
        focus(area, solo, framing) { this.focuses.push({name:this.doc.name,area,solo,framing}); }
        renderPreview() { this.renders++; }
        dispose() { this.disposed = true; }
      }
    `,
        }));
      },
    },
  ],
});
const server = createServer((req, res) => {
  res.setHeader(
    "Content-Type",
    req.url === "/test.js" ? "text/javascript" : "text/html",
  );
  res.end(
    req.url === "/test.js"
      ? bundle.outputFiles[0].text
      : '<style>.scene-container,.scene-host{width:960px;height:540px}</style><div id="root"></div><script src="/test.js"></script>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.probe?.finish);
  await page.evaluate(() => window.probe.finish());
  await page.locator(".scene-status").waitFor({ state: "hidden" });
  await page.waitForTimeout(100); // let the initial ResizeObserver settle
  await page.evaluate(() => {
    window.probe.focuses.length = 0;
  });
  const install = async (name, framing) => {
    await page.evaluate(
      ({ name, framing }) => {
        const doc = structuredClone(
          window.probe.doc.layers.length ? window.probe.doc : window.fixture,
        );
        doc.name = name;
        doc.environment.background = "#351048";
        if (framing !== undefined) doc.camera.framing = framing;
        window.install(doc);
      },
      { name, framing },
    );
    await page.waitForFunction((name) => window.probe.doc.name === name, name);
  };
  await install("first generated", 0.75);
  await install("live edit during first preparation");
  await page.evaluate(() => window.probe.finish());
  await page.locator(".scene-status").waitFor({ state: "hidden" });
  let state = await page.evaluate(() => ({
    focuses: window.probe.focuses,
    background: window.probe.doc.environment.background,
  }));
  assert.equal(
    state.background,
    "#351048",
    "authored environment must survive",
  );
  assert.equal(state.focuses.length, 1, "superseded completion must not focus");
  assert.equal(state.focuses[0].name, "live edit during first preparation");
  assert.equal(state.focuses[0].framing, 0.75);
  assert.equal(
    state.focuses[0].area.left,
    96,
    "fit must respect the left panel",
  );
  assert.equal(
    state.focuses[0].area.width,
    758,
    "fit must respect both panels",
  );

  await install("authored camera change", 0.6);
  await install("live edit during camera preparation");
  await page.evaluate(() => window.solo(window.probe.doc.layers[0].id));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.probe.finish());
  await page.locator(".scene-status").waitFor({ state: "hidden" });
  state = await page.evaluate(() => ({
    focuses: window.probe.focuses,
    id: window.probe.doc.layers[0].id,
  }));
  assert.equal(state.focuses.length, 2);
  assert.equal(state.focuses[1].name, "live edit during camera preparation");
  assert.equal(state.focuses[1].framing, 0.6);
  assert.equal(
    state.focuses[1].solo,
    state.id,
    "completion uses the latest solo selection",
  );

  await install("ordinary edit after preparation");
  await page.evaluate(() => window.probe.finish());
  await page.waitForTimeout(80);
  state = await page.evaluate(() => ({
    focuses: window.probe.focuses,
    install: window.probe.installs.at(-1),
    renders: window.probe.renders,
  }));
  assert.equal(
    state.focuses.length,
    2,
    "ordinary edits preserve the user's orbit",
  );
  assert.equal(state.install.options.preserveCamera, true);
  assert.ok(state.renders > 0, "playback resumes after preparation");

  await install("unmount while preparing", 0.8);
  await page.evaluate(() => {
    window.root.unmount();
    window.probe.finish();
  });
  await page.waitForTimeout(80);
  state = await page.evaluate(() => ({
    disposed: window.probe.disposed,
    focuses: window.probe.focuses.length,
  }));
  assert.equal(state.disposed, true);
  assert.equal(state.focuses, 2, "unmounted completions must not focus");
  assert.deepEqual(errors, []);
  console.log(
    "Workspace integration passed: authored environment, latest framing/solo, pending edit, orbit preservation, unmount.",
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
