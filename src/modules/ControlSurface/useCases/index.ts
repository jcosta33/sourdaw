// ControlSurface/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

// ── MIDI Learn (live cross-module consumers: AudioEngine webMidiInput) ─────────
export { completeMidiLearn } from './midiLearn/completeMidiLearn';
export { handleMidiMessage } from './midiLearn/handleMidiMessage';
export { getMidiLearnState } from './getMidiLearnState';

// ── Composition-root DI seam (bootstrap injects cross-module writers) ──────────
export { setMidiLearnDependencies } from './midiLearn/midiLearnDependencies';

// ── Hardware mappings ─────────────────────────────────────────────────────────
export { exportHardwareMappings } from './hardware/exportHardwareMappings';
export { importHardwareMappings } from './hardware/importHardwareMappings';

// ── Command handlers ──────────────────────────────────────────────────────────
export { getControlSurfaceHandlers } from './getControlSurfaceHandlers';
