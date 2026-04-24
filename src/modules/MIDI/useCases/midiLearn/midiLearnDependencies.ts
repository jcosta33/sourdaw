import type { Track } from '#/modules/Arrangement/stores';

/**
 * Cross-module writers that MIDI learn dispatches mappings to. Registered once
 * at app init (`src/app/bootstrap.ts`) with real implementations. Pulling the
 * functions out of `handleMidiMessage.ts` into a DI seam breaks the
 * `MIDI/useCases → Arrangement/useCases → ... → MIDI/useCases` static cycle
 * that prevented hundreds of other cycles from clearing.
 */
export type MidiLearnDependencies = {
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

let dependencies: MidiLearnDependencies | null = null;

export function setMidiLearnDependencies(deps: MidiLearnDependencies): void {
    dependencies = deps;
}

export function getMidiLearnDependencies(): MidiLearnDependencies {
    if (!dependencies) {
        throw new Error('MIDI learn dependencies not initialized');
    }
    return dependencies;
}
