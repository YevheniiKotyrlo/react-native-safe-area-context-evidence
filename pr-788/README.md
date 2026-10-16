# #788: a window resize measured once for every provider

[AppAndFlow/react-native-safe-area-context#788](https://github.com/AppAndFlow/react-native-safe-area-context/pull/788)

## Builds

Both builds bundle the library from its source with esbuild, React Native aliased to React Native Web, and run the same scene: two nested `SafeAreaProvider`s, as an Expo Router app with an app shell's own provider mounts them, and a `useSafeAreaFrame()` readout.

| Build | Source |
| --- | --- |
| release | `src/` of the published `react-native-safe-area-context@5.10.1` |
| pull-request | the same, with `src/NativeSafeAreaProvider.web.tsx` from the PR head, `1e76535` |

```sh
npm install
npm run build     # dist/release and dist/pull-request
npm run measure   # writes readings/sweep.json and prints the table
```

## Steps

`measure.mjs` opens each build in Chromium, Firefox and WebKit at 1280 × 800, then narrows the viewport to 520 px in 190 steps of 4 px, waiting two animation frames after each. A script installed before the bundle runs counts every `getBoundingClientRect` call, the calls made while a `resize` event is dispatched, and the window `resize` listeners, and logs from a `requestAnimationFrame` loop what each frame paints. A `<Profiler>` around the scene counts React commits. In Chromium, the DevTools protocol's `Performance.getMetrics` counts layouts across the sweep.

A page is refused unless its window `resize` listeners match its build (one per provider for the release, one for the PR), the providers report the final 520 × 800 frame, and nothing threw.

## Readings

Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 (Playwright 1.63.0), two runs each, every run identical, [`readings/sweep.json`](readings/sweep.json):

| Build | React commits | window `resize` listeners | steps painting their metrics in the resize's own frame | layouts (Chromium) |
| --- | --- | --- | --- | --- |
| release | 570 | 2 | 190 of 190 | 570 |
| pull-request | 191 | 1 | 190 of 190 | 570 |

The release commits three times per step: once for each provider's `resize` listener, whose updates React commits separately, and once more in the next frame, when the providers' `ResizeObserver`s report the values their listeners already reported. The PR commits once on 189 steps and twice on one. Both builds read the provider's rect 760 times, 380 of them inside the `resize` event.
