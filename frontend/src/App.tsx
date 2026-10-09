import { useState } from "react";
import { MainPage } from "./pages/MainPage";
import { SpaceBackdrop } from "./components/space/SpaceBackdrop";
import { IntroSequence, introEnabled } from "./components/intro/IntroSequence";
import { PALETTE_BLOCKS } from "./components/BlockPalette";
import { EXAMPLE_PRESETS } from "./pages/examples";
import { motionEnabled } from "./features/motion/useReducedMotion";

export default function App() {
  // The workspace mounts at once, hidden under the intro, so it is ready when the intro ends.
  const [showIntro, setShowIntro] = useState(() => introEnabled() && motionEnabled());
  return (
    <>
      <SpaceBackdrop />
      <div className={`app-shell ${showIntro ? "is-hidden" : "is-revealed"}`}>
        <MainPage />
      </div>
      {showIntro && (
        <IntroSequence
          blockTypeCount={PALETTE_BLOCKS.length}
          exampleCount={EXAMPLE_PRESETS.length}
          onDone={() => setShowIntro(false)}
        />
      )}
    </>
  );
}
