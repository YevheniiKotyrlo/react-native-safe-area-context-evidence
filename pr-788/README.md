# #788: a window resize measured once, after layout

[AppAndFlow/react-native-safe-area-context#788](https://github.com/AppAndFlow/react-native-safe-area-context/pull/788)

## Builds

Both builds bundle the library from its source with esbuild, React Native aliased to React Native Web, and run the same scene: two nested `SafeAreaProvider`s, as an Expo Router app with an app shell's own provider mounts them, and a `useSafeAreaFrame()` readout.

| Build | Source |
| --- | --- |
| release | `src/` of the published `react-native-safe-area-context@5.10.1` |
| pull-request | the same, with `src/NativeSafeAreaProvider.web.tsx` from the PR head, `5ac0d01` |

```sh
npm install
npm run build     # dist/release and dist/pull-request
npm run measure   # writes readings/sweep.json and prints the table
```

## Steps

`measure.mjs` opens each build in Chromium, Firefox and WebKit at 1280 × 800, then narrows the viewport to 520 px in 190 steps of 4 px, waiting two animation frames after each. A script installed before the bundle runs counts every `getBoundingClientRect` call, the calls made while a `resize` event is dispatched — which run before the frame's layout and so force one — and the window `resize` listeners. A `<Profiler>` around the scene counts React commits.

A page is refused unless its window `resize` listeners match its build (two for the release, none for the PR), the providers report the final 520 × 800 frame, and nothing threw.

## Readings

Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6 (Playwright 1.63.0), two runs each, [`readings/sweep.json`](readings/sweep.json):

| Build | React commits | `getBoundingClientRect` calls | inside the `resize` event | window `resize` listeners |
| --- | --- | --- | --- | --- |
| release | 570 (one WebKit run: 569) | 760 | 380 | 2 |
| pull-request | 190 | 380 | 0 | 0 |
