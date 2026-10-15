import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium, firefox, webkit } from 'playwright';

const ENGINES = { chromium, firefox, webkit };
const VARIANTS = ['release', 'pull-request'];
const RUNS = 2;
const HEIGHT = 800;
const START_WIDTH = 1280;
const STEP_WIDTH = 4;
const STEPS = 190;
const END_WIDTH = START_WIDTH - STEPS * STEP_WIDTH;
const ORIGIN = 'http://harness.test';
const PROVIDERS = 2;
const EXPECTED_RESIZE_LISTENERS = { 'pull-request': 0, release: PROVIDERS };

// Runs before the bundle: counts rect reads, the ones made while a resize event is dispatched (before the frame's layout), and window resize listeners.
const installProbe = () => {
  const probe = { rectReads: 0, rectReadsInResizeEvent: 0, resizeListeners: 0 };
  window.resizeProbe = probe;
  const readRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    probe.rectReads += 1;
    if (window.event?.type === 'resize') {
      probe.rectReadsInResizeEvent += 1;
    }
    return readRect.call(this);
  };
  const addListener = window.addEventListener;
  window.addEventListener = function addEventListener(type, ...rest) {
    if (type === 'resize') {
      probe.resizeListeners += 1;
    }
    return addListener.call(this, type, ...rest);
  };
};

const readCounters = (page) =>
  page.evaluate(() => ({
    commits: window.sceneCommits,
    rectReads: window.resizeProbe.rectReads,
    rectReadsInResizeEvent: window.resizeProbe.rectReadsInResizeEvent,
    resizeListeners: window.resizeProbe.resizeListeners,
  }));

const waitForTwoFrames = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }),
  );

const measureVariant = async (engineName, browser, variant) => {
  const context = await browser.newContext({ viewport: { height: HEIGHT, width: START_WIDTH } });
  try {
    await context.addInitScript(installProbe);
    await context.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({ path: path.resolve('dist', `.${new URL(route.request().url()).pathname}`) }),
    );
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${ORIGIN}/${variant}/index.html`);
    const readout = page.getByTestId('frame');
    await readout.waitFor();
    await waitForTwoFrames(page);

    const countersBefore = await readCounters(page);
    for (let step = 1; step <= STEPS; step += 1) {
      await page.setViewportSize({ height: HEIGHT, width: START_WIDTH - step * STEP_WIDTH });
      await waitForTwoFrames(page);
    }
    const countersAfter = await readCounters(page);
    const finalReadout = await readout.textContent();

    if (pageErrors.length > 0) {
      throw new Error(`${engineName} ${variant}: the page threw: ${pageErrors.join('; ')}`);
    }
    if (countersAfter.resizeListeners !== EXPECTED_RESIZE_LISTENERS[variant]) {
      throw new Error(
        `${engineName} ${variant}: ${countersAfter.resizeListeners} window resize listeners, expected ${EXPECTED_RESIZE_LISTENERS[variant]} — the page does not run the build it claims`,
      );
    }
    if (finalReadout !== `frame ${END_WIDTH} x ${HEIGHT}`) {
      throw new Error(`${engineName} ${variant}: the provider reported "${finalReadout}" after the sweep`);
    }
    return {
      browser: `${engineName} ${browser.version()}`,
      commits: countersAfter.commits - countersBefore.commits,
      finalReadout,
      rectReads: countersAfter.rectReads - countersBefore.rectReads,
      rectReadsInResizeEvent: countersAfter.rectReadsInResizeEvent - countersBefore.rectReadsInResizeEvent,
      resizeListeners: countersAfter.resizeListeners,
      variant,
    };
  } finally {
    await context.close();
  }
};

const readings = [];
for (const [engineName, engine] of Object.entries(ENGINES)) {
  const browser = await engine.launch();
  try {
    for (let run = 1; run <= RUNS; run += 1) {
      for (const variant of VARIANTS) {
        readings.push({ run, ...(await measureVariant(engineName, browser, variant)) });
      }
    }
  } finally {
    await browser.close();
  }
}

await mkdir('readings', { recursive: true });
await writeFile(
  path.join('readings', 'sweep.json'),
  `${JSON.stringify({ endWidth: END_WIDTH, height: HEIGHT, readings, startWidth: START_WIDTH, steps: STEPS }, null, 2)}\n`,
);

console.log(
  `${STEPS} steps of ${STEP_WIDTH} px, ${START_WIDTH} → ${END_WIDTH} px wide, ${HEIGHT} px high, ${PROVIDERS} nested providers\n`,
);
console.log('| browser | build | run | React commits | rect reads | inside the resize event | window resize listeners |');
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const reading of readings) {
  console.log(
    `| ${reading.browser} | ${reading.variant} | ${reading.run} | ${reading.commits} | ${reading.rectReads} | ${reading.rectReadsInResizeEvent} | ${reading.resizeListeners} |`,
  );
}
