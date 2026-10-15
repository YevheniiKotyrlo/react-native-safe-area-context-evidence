import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { build } from 'esbuild';

const PULL_REQUEST_HEAD = '5ac0d0113671b68400ebc3d82b61e33919b22f1e';
const PROVIDER_FILE = 'NativeSafeAreaProvider.web.tsx';
const PROVIDER_URL = `https://raw.githubusercontent.com/YevheniiKotyrlo/react-native-safe-area-context/${PULL_REQUEST_HEAD}/src/${PROVIDER_FILE}`;
const RELEASE_SOURCE = path.resolve('node_modules/react-native-safe-area-context/src');

const fetchPullRequestProvider = async () => {
  const response = await fetch(PROVIDER_URL);
  if (!response.ok) {
    throw new Error(`${PROVIDER_URL} answered ${response.status}`);
  }
  return response.text();
};

// Resolves the library to the variant's own copy of its source, and React Native to React Native Web.
const resolveVariantSource = (source) => ({
  name: 'variant-source',
  setup(builder) {
    builder.onResolve({ filter: /^react-native-safe-area-context$/ }, () => ({
      path: path.join(source, 'index.tsx'),
    }));
    builder.onResolve({ filter: /^react-native$/ }, (args) =>
      builder.resolve('react-native-web', { kind: args.kind, resolveDir: args.resolveDir }),
    );
  },
});

const variants = [
  { name: 'release', provider: undefined },
  { name: 'pull-request', provider: await fetchPullRequestProvider() },
];

for (const variant of variants) {
  const directory = path.resolve('dist', variant.name);
  const source = path.join(directory, 'src');
  await rm(directory, { force: true, recursive: true });
  await cp(RELEASE_SOURCE, source, { recursive: true });
  if (variant.provider !== undefined) {
    const releaseProvider = await readFile(path.join(source, PROVIDER_FILE), 'utf8');
    if (releaseProvider === variant.provider) {
      throw new Error(`the pull request's ${PROVIDER_FILE} equals the release's`);
    }
    await writeFile(path.join(source, PROVIDER_FILE), variant.provider);
  }
  await cp('index.html', path.join(directory, 'index.html'));
  await build({
    bundle: true,
    define: { 'process.env.NODE_ENV': '"development"' },
    entryPoints: ['app.tsx'],
    format: 'esm',
    jsx: 'automatic',
    logLevel: 'warning',
    outfile: path.join(directory, 'bundle.js'),
    plugins: [resolveVariantSource(source)],
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js'],
  });
  console.log(`built dist/${variant.name}`);
}
