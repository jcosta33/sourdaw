// ── Type re-exports (DTO pattern) ─────────────────────────────────────
export type { Track, Clip, Device } from '#/modules/Track/models/Track';
export type { TrackKind } from '#/modules/Track/models/Track';
export type { MidiNote, MidiCC, MidiPitchBend } from '#/modules/Midi/models/MidiNote';
export type { AutomationLane, AutomationPoint } from '#/modules/Automation/models/Automation';
export type { DeviceParameter, DeviceParameterType } from '#/modules/Track/models/DeviceParameter';
export type { SoundPresetCategory, SoundPreset } from '#/modules/Track/models/SoundPreset';
export type { WarpState } from '#/modules/Clip/models/WarpMarker';
export type { MidiLearnState } from '#/modules/Midi/stores/midiLearnStore';

export { BUILTIN_PLUGINS } from '#/modules/Track/models/DeviceParameter';
export { createTrack } from '#/modules/Track/models/Track';
export { createMidiNote } from '#/modules/Midi/models/MidiNote';

// ── Helpers ───────────────────────────────────────────────────────────
export { getPlatformPlugins } from '#/modules/Track/helpers/getPlatformPlugins';

// ── Track queries ────────────────────────────────────────────────────
export { getAllTracks } from './getAllTracks';
export { getTrackById } from './getTrackById';
export { getTrackStoreState, setTrackStoreState } from './trackStoreAccess';

// ── Cross-module accessors (boundary violations — see individual files) ──
export { getMidiStoreState, setMidiStoreState, getMidiLearnState } from './midiStoreAccess';
export { getAutomationLanes, getAutomationStoreState } from './automationStoreAccess';
