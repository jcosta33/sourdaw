import { createTrack, resetArrangementStoresForProject } from '#/modules/Arrangement/useCases';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { hydrateGrooveTemplates } from '#/modules/MIDI/useCases';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';

import { projectStore } from '../../../stores/projectStore';

import type { Track } from '#/modules/Arrangement/stores';

type InitProjectInput = {
    name: string;
    bpm: number;
    timeSig?: [number, number];
    keyRoot?: number;
    scaleName?: string;
    loopEnd?: number;
};

export function initProject(input: InitProjectInput): Track {
    const timeSigNum = input.timeSig?.[0] ?? 4;
    const timeSigDen = input.timeSig?.[1] ?? 4;

    resetArrangementStoresForProject();
    chordTrackStore.set({ enabled: false, events: [] });
    hydrateGrooveTemplates({ templates: [], assignments: [] });

    transportStore.set({
        ...defaultTransportState,
        tempo: input.bpm,
        timeSignatureNumerator: timeSigNum,
        timeSignatureDenominator: timeSigDen,
        loopEnd: input.loopEnd ?? 64,
        isLooping: true,
    });

    projectStore.set({
        name: input.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
        initialized: true,
        keyRoot: input.keyRoot ?? 0,
        scaleName: input.scaleName ?? 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: Array.from({ length: 128 }, (_, noteIndex) => 440 * 2 ** ((noteIndex - 69) / 12)),
        },
    });

    return createTrack({ name: 'Master', kind: 'master' });
}
