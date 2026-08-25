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
     * What a gain request actually becomes: the fader law's clamp.
     * `handleMidiMessage` writes the store and the engine through two separate
     * calls, and only the store-side one clamps — so a controller riding a
     * mapping past the fader ceiling left the engine running above the value
     * the project recorded, and the two disagreed until something else rewrote
     * the node. Resolving the value once, here, is what keeps the pair honest.
     */
    clampTrackGain: (gain: number) => number;
    setTrackGainArrangement: (trackId: string, gain: number) => void;
    setTrackPanArrangement: (trackId: string, pan: number) => void;
    setDeviceParameter: (deviceId: string, paramId: string, value: number) => void;
    engineSetTrackGain: (trackId: string, gain: number) => void;
    engineSetTrackPan: (trackId: string, pan: number) => void;
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
