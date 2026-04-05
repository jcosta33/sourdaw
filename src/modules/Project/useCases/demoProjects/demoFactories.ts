// ---------------------------------------------------------------------------
// demoFactories — barrel re-export
// Each demo project lives in its own sub-directory.
// This file exists solely for backward compatibility: the public barrel
// (./index.ts) and any legacy imports keep working without change.
// ---------------------------------------------------------------------------

export { demo1_TheCompleteMix } from './resonance/createResonanceDemo';
export { demo_SweetDreams } from './sweetDreams/createSweetDreamsDemo';
export { demo4_NativeShowcase } from './synthwave/createSynthwaveDemo';
export { demo5_NebulaDrift } from './nebulaDrift/createNebulaDriftDemo';
