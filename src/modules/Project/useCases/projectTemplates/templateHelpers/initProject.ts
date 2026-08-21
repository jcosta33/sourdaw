import { createTrack, resetArrangementStoresForProject } from '#/modules/Arrangement/useCases';
import { hydrateGrooveTemplates, replaceChordTrackState } from '#/modules/MIDI/useCases';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';

import { projectStore } from '../../../stores/projectStore';
import { createFreshProjectMetadata } from '../../createFreshProjectMetadata';

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

    projectStore.set(
        createFreshProjectMetadata({
            name: input.name,
            loading: true,
            // Ready is NOT latched here. initProject runs at the START of an async
            // template build (before finalizeTemplate commits tracks + selection);
            // latching `initialized` now signals workspace-ready before the build's
            // writes settle, so the template's late-landing setTrackState clobbers any
            // track the user selects in that window (CC-10 manifestation). The ready
            // latch is published by createFromTemplate AFTER the template action
            // completes and its writes are committed.
            initialized: false,
            keyRoot: input.keyRoot,
            scaleName: input.scaleName,
        })
    );

    return createTrack({ name: 'Master', kind: 'master' });
}
