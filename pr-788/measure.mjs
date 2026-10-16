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
const EXPECTED_RESIZE_LISTENERS = { 'pull-request': 1, release: PROVIDERS };

// Runs before the bundle: counts rect reads, the ones made while a resize event is dispatched, and window resize listeners, and logs what each frame paints.
const installProbe = () => {
  const probe = { frames: [], rectReads: 0, rectReadsInResizeEvent: 0, resizeListeners: 0 };
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
  // A requestAnimationFrame callback runs before the frame's layout and paint, so the readout it sees is the one that frame paints.
  const logFrame = () => {
    probe.frames.push({
      commits: window.sceneCommits,
      innerWidth: window.innerWidth,
      readout: document.querySelector('[data-testid="frame"]')?.textContent,
    });
    requestAnimationFrame(logFrame);
  };
  requestAnimationFrame(logFrame);
};

const readCounters = (page) =>
  page.evaluate(() => ({
    commits: window.sceneCommits,
    frames: window.resizeProbe.frames.length,
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

// For each step, the frames between the first one at the step's width and the first one painting the provider's frame at that width.
const countFramesToPaint = (frames) => {
  const histogram = {};
  for (let step = 1; step <= STEPS; step += 1) {
    const width = START_WIDTH - step * STEP_WIDTH;
    const resized = frames.findIndex((frame) => frame.innerWidth === width);
    const painted = frames.findIndex((frame) => frame.readout === `frame ${width} x ${HEIGHT}`);
    const key = resized === -1 || painted === -1 ? 'unseen' : String(painted - resized);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return histogram;
};

// For each step, the commits from the last frame at the previous width to the last frame at the step's width.
const countCommitsPerStep = (frames) => {
  const lastFrameAt = (width) => frames.findLast((frame) => frame.innerWidth === width);
  const histogram = {};
  for (let step = 1; step <= STEPS; step += 1) {
    const previous = lastFrameAt(START_WIDTH - (step - 1) * STEP_WIDTH);
    const current = lastFrameAt(START_WIDTH - step * STEP_WIDTH);
    const key = previous === undefined || current === undefined ? 'unseen' : String(current.commits - previous.commits);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return histogram;
};

const readLayoutMetrics = async (session) => {
  const { metrics } = await session.send('Performance.getMetrics');
  const read = (name) => metrics.find((metric) => metric.name === name)?.value;
  return { layoutCount: read('LayoutCount'), recalcStyleCount: read('RecalcStyleCount') };
};

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
    const session = engineName === 'chromium' ? await context.newCDPSession(page) : undefined;
    await session?.send('Performance.enable');
    await page.goto(`${ORIGIN}/${variant}/index.html`);
    const readout = page.getByTestId('frame');
    await readout.waitFor();
    await waitForTwoFrames(page);

    const countersBefore = await readCounters(page);
    const layoutBefore = session === undefined ? undefined : await readLayoutMetrics(session);
    for (let step = 1; step <= STEPS; step += 1) {
      await page.setViewportSize({ height: HEIGHT, width: START_WIDTH - step * STEP_WIDTH });
      await waitForTwoFrames(page);
    }
    await page.waitForTimeout(500);
    const countersAfter = await readCounters(page);
    const layoutAfter = session === undefined ? undefined : await readLayoutMetrics(session);
    const finalReadout = await readout.textContent();
    const frames = await page.evaluate((from) => window.resizeProbe.frames.slice(from - 1), countersBefore.frames);

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
      commitsAtMount: countersBefore.commits,
      commitsPerStep: countCommitsPerStep(frames),
      finalReadout,
      framesToPaint: countFramesToPaint(frames),
      ...(layoutBefore === undefined || layoutAfter === undefined
        ? {}
        : {
            layoutCount: layoutAfter.layoutCount - layoutBefore.layoutCount,
            recalcStyleCount: layoutAfter.recalcStyleCount - layoutBefore.recalcStyleCount,
          }),
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
console.log(
  '| browser | build | run | React commits | at mount | per step | rect reads | inside the resize event | window resize listeners | frames from a resize to its paint | layouts | style recalcs |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const reading of readings) {
  console.log(
    `| ${reading.browser} | ${reading.variant} | ${reading.run} | ${reading.commits} | ${reading.commitsAtMount} | ${JSON.stringify(reading.commitsPerStep)} | ${reading.rectReads} | ${reading.rectReadsInResizeEvent} | ${reading.resizeListeners} | ${JSON.stringify(reading.framesToPaint)} | ${reading.layoutCount ?? ''} | ${reading.recalcStyleCount ?? ''} |`,
  );
}
