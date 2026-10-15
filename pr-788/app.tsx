import { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaFrame } from 'react-native-safe-area-context';

declare global {
  interface Window {
    sceneCommits: number;
  }
}

window.sceneCommits = 0;

function FrameReadout() {
  const frame = useSafeAreaFrame();
  return <Text testID="frame">{`frame ${frame.width} x ${frame.height}`}</Text>;
}

// Two providers, as in an Expo Router app (its root provider) with an app shell that mounts its own.
function Scene() {
  return (
    <SafeAreaProvider>
      <SafeAreaProvider>
        <FrameReadout />
      </SafeAreaProvider>
    </SafeAreaProvider>
  );
}

const root = document.getElementById('root');
if (root === null) {
  throw new Error('index.html has no #root');
}

createRoot(root).render(
  <Profiler
    id="scene"
    onRender={() => {
      window.sceneCommits += 1;
    }}
  >
    <Scene />
  </Profiler>,
);
