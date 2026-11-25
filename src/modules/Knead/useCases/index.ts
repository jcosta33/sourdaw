export { analyzeClipPitch } from './analyzeClipPitch';
export { captureClipPitchAnalysis } from './captureClipPitchAnalysis';
export { clearClipPitchAnalysis } from './clearClipPitchAnalysis';
export { restoreClipPitchAnalysis } from './restoreClipPitchAnalysis';
export { hostsKnead } from './hostsKnead';
export { hydrateKneadFromTrackStore } from './hydrateKneadFromTrackStore';
export { syncKneadToEngine } from './syncKneadToEngine';
export { updateClipKneadState } from './updateClipKneadState';
export { updateTransientClipKneadState } from './updateTransientClipKneadState';

// Pitch-edit dispatch — Knead owns the pitch aggregate and its commit flow
// (ADR 0011 Wave 3). Value-only surface: no `export type` here (use-case
// types stay private).
export { getPitchHandlers } from './getPitchHandlers';
export { resetKneadForProject } from './resetKneadForProject';
