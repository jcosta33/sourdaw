import type { Track } from '#/modules/Arrangement/stores';

/**
 * Cross-module writers that MIDI learn dispatches mappings to. Registered once
 * at app init (`src/app/bootstrap.ts`) with real implementations. Pulling the
 * functions out of `handleMidiMessage.ts` into a DI seam breaks the
 * `MIDI/useCases → Arrangement/useCases → ... → MIDI/useCases` static cycle
 * that prevented hundreds of other cycles from clearing.
 */
export type MidiLearnDependencies = {
    /**
     * Track gain and pan are written through the Arrangement setters alone.
     * Each one clamps to its field's law, writes the engine, persists project
     * truth and records the ride — a second, direct engine setter in this
     * surface made every learned controller event drive the AudioParam's
     * smoothing ramp twice (#2772), so no engine writer is exposed here.
     */
    setTrackGainArrangement: (trackId: string, gain: number) => void;
    setTrackPanArrangement: (trackId: string, pan: number) => void;
    setDeviceParameter: (deviceId: string, paramId: string, value: number) => void;
    setFermenterMappedParam: (input: { deviceId: string; paramId: string; value: number }) => void;
    recordAutomationValue: (trackId: string, lane: string, value: number, beat: number) => void;
    getTransportIsPlaying: () => boolean;
    getTransportPlayheadPosition: () => number;
    getAllTracks: () => Track[];
};

export const midiLearnDependenciesHolder: { current: MidiLearnDependencies | null } = {
    current: null,
};

export function setMidiLearnDependencies(deps: MidiLearnDependencies): void {
    midiLearnDependenciesHolder.current = deps;
}
