// ── Type re-exports (DTO pattern) ─────────────────────────────────────
export type { Track, Clip, Device, TrackAlternative, StretchMode, AutomationMode } from '#/modules/Arrangement/models/Track';
export type { TrackKind } from '#/modules/Arrangement/models/Track';
export type { MidiNote, MidiCC, MidiPitchBend } from '#/modules/MIDI/useCases/midi';
export type { AutomationLane, AutomationPoint, AutomationCurveType } from '#/modules/Automation/useCases/automation/types';
export { createAutomationLane } from '#/modules/Automation/useCases/automation/createAutomationLane';
export type { ChordEvent } from '#/modules/MIDI/models/ChordEvent';
export type { DeviceParameter, DeviceParameterType } from '#/modules/Arrangement/models/DeviceParameter';
export type { SoundPresetCategory, SoundPreset } from '#/modules/Arrangement/models/SoundPreset';
export type { WarpState } from '#/modules/Arrangement/models/WarpMarker';
export type { MidiLearnState } from '#/modules/MIDI/stores/midiLearnStore';

export { BUILTIN_PLUGINS, isDeviceSupportedOnCurrentPlatform, getPluginById } from '#/modules/Arrangement/models/DeviceParameter';
export { createTrack } from '#/modules/Arrangement/models/Track';
export { createMidiNote } from '#/modules/MIDI/useCases/midi';

// ── Helpers ───────────────────────────────────────────────────────────
export { getPlatformPlugins } from '#/modules/Arrangement/repositories/getPlatformPlugins';

// ── Track queries ────────────────────────────────────────────────────
export { getAllTracks } from './getAllTracks';
export { getTrackById } from './getTrackById';
export { getTrackStoreState, getTrackState, setTrackStoreState } from './trackStoreAccess';

// ── Track mutations (contract wrappers for cross-module consumers) ───
export {
    setTrackState,
    updateTrack,
    updateClip,
    updateClipsOnAllTracks,
    mapAllTracks,
    type TrackState,
} from './trackMutations';

// ── Cross-module accessors (boundary violations — see individual files) ──
export { getMidiStoreState, setMidiStoreState, getMidiLearnState } from './midiStoreAccess';
export { getAutomationLanes, getAutomationStoreState } from './automationStoreAccess';
