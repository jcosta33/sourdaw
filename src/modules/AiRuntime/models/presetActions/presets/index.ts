// ── Category presets barrel ─────────────────────────────────────────────
//
// Aggregates all category-specific preset arrays and the shared types /
// helper builders into a single re-export point consumed by registry.ts.

export { type PresetContext, type PresetAction, type PresetCategory, trackAction, clipAction } from './types';
export { transportPresets } from './transport';
export { trackPresets } from './track';
export { devicePresets } from './device';
export { clipPresets } from './clip';
export { midiPresets } from './midi';
export { generatePresets } from './generate';
export { workspacePresets } from './workspace';
export { mixPresets, automationPresets } from './mixAndAutomation';
export { filePresets, collaborationPresets } from './fileAndCollaboration';
