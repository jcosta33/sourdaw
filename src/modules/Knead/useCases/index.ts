export { analyzeClipPitch } from './analyzeClipPitch';
export { captureClipPitchAnalysis } from './captureClipPitchAnalysis';
export { clearClipPitchAnalysis } from './clearClipPitchAnalysis';
export { restoreClipPitchAnalysis } from './restoreClipPitchAnalysis';
export { hydrateKneadFromTrackStore } from './hydrateKneadFromTrackStore';
export { syncKneadToEngine } from './syncKneadToEngine';
export { updateClipKneadState } from './updateClipKneadState';

// Pitch-edit dispatch + engine dependency injection — Knead owns the pitch
// aggregate and its commit flow (ADR 0011 Wave 3). Value-only surface:
// no `export type` here (use-case types stay private).
export { getPitchHandlers } from './getPitchHandlers';
export { setPitchEditDependencies } from './pitch/pitchEditDependencies';
