import { createTrack, resetArrangementStoresForProject } from '#/modules/Arrangement/useCases';
import { hydrateGrooveTemplates, replaceChordTrackState } from '#/modules/MIDI/useCases';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';

import { createDefaultProductionBrief } from '../../../models/ProductionBrief';
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
    replaceChordTrackState({ enabled: false, events: [] });
    hydrateGrooveTemplates({ templates: [], assignments: [] });

    transportStore.set({
        ...defaultTransportState,
        tempo: input.bpm,
        timeSignatureNumerator: timeSigNum,
        timeSignatureDenominator: timeSigDen,
        loopEnd: input.loopEnd ?? 64,
        isLooping: true,
    });

    const createdAt = Date.now();
    projectStore.set({
        name: input.name,
        createdAt,
        updatedAt: createdAt,
        dirty: false,
        loading: true,
        // Ready is NOT latched here. initProject runs at the START of an async
        // template build (before finalizeTemplate commits tracks + selection);
        // latching `initialized` now signals workspace-ready before the build's
        // writes settle, so the template's late-landing setTrackState clobbers any
        // track the user selects in that window (CC-10 manifestation). The ready
        // latch is published by createFromTemplate AFTER the template action
        // completes and its writes are committed.
        initialized: false,
        keyRoot: input.keyRoot ?? 0,
        scaleName: input.scaleName ?? 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: Array.from({ length: 128 }, (_, noteIndex) => 440 * 2 ** ((noteIndex - 69) / 12)),
        },
        productionBrief: createDefaultProductionBrief(createdAt),
    });

    return createTrack({ name: 'Master', kind: 'master' });
}
