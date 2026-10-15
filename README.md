# react-native-safe-area-context evidence

Before/after captures and measurements for my react-native-safe-area-context pull requests. Every pair comes from one device or browser in one run: `before` is the stock release its PR comment names, `after` is the same scene with the PR applied, and nothing else differs. Each capture is cropped to the probe.

Android captures come from a stock emulator at 1140x2400, density 480.

| PR | Evidence |
| --- | --- |
| [#785](https://github.com/AppAndFlow/react-native-safe-area-context/pull/785): a bar hidden through the system UI visibility on Android 6–10 | [`images/pr-785-*`](images) |
| [#788](https://github.com/AppAndFlow/react-native-safe-area-context/pull/788): a window resize measured once, after layout, on web | [pr-788](pr-788/README.md) |
