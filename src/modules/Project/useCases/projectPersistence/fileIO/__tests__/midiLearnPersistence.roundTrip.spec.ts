import { beforeEach, describe, expect, it, vi } from 'vitest';

import { midiLearnStore } from '#/modules/ControlSurface/stores';

import { hydrateArrangementStoreFromProjectData } from '../../helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../../helpers/hydrateModuleStoresFromProjectData';
import { isHydratableProjectData } from '../../helpers/isHydratableProjectData';
import { buildProjectData } from '../buildProjectData';

vi.mock('../../../arrangement/syncCurrentArrangementToStore', () => ({
    syncCurrentArrangementToStore: vi.fn(),
}));

const EMPTY_MIDI_LEARN = {
    mappingsSchemaVersion: 1,
    mappings: [],
    isLearning: false,
    learningTarget: null,
};

const LEARNED_VOLUME_CC = {
    id: 'mapping-volume-cc7',
    channel: 0,
    cc: 7,
    targetType: 'trackGain' as const,
    trackId: 'track-vox',
    minValue: 0,
    maxValue: 1,
};

/**
 * Open Recent, Discard changes, and `.sourdaw` import all rebuild the project
 * from `buildProjectData`'s JSON: `replaceProjectData` resets the CRDT root, so
 * every root slot projects its `hydrateMissing` default, then hydrates the
 * module stores from the file. This drives that same sequence.
 */
async function reopenFromNamedProjectJson(): Promise<void> {
    const built = await buildProjectData();
    if (!built) {
        throw new Error('expected buildProjectData to produce a snapshot');
    }
    const namedProjectJson = JSON.stringify(built.data);
    const onDisk: unknown = JSON.parse(namedProjectJson);

    midiLearnStore.set(EMPTY_MIDI_LEARN);

    if (!isHydratableProjectData(onDisk)) {
        throw new Error('the snapshot this build just wrote was rejected by its own import validator');
    }
    hydrateArrangementStoreFromProjectData({ data: onDisk, preserveSavedArrangements: true });
    hydrateModuleStoresFromProjectData(onDisk);
}

describe('MIDI Learn mappings across a named-project reopen', () => {
    beforeEach(() => {
        midiLearnStore.set(EMPTY_MIDI_LEARN);
    });

    it('writes the learned mappings into the saved project', async () => {
        midiLearnStore.set({ ...EMPTY_MIDI_LEARN, mappings: [LEARNED_VOLUME_CC] });

        const built = await buildProjectData();

        expect(JSON.stringify(built?.data).includes(LEARNED_VOLUME_CC.id)).toBe(true);
    });

    it('returns the learned CC mapping after the project is reopened', async () => {
        midiLearnStore.set({ ...EMPTY_MIDI_LEARN, mappings: [LEARNED_VOLUME_CC] });

        await reopenFromNamedProjectJson();

        expect(midiLearnStore.value?.mappings).toEqual([LEARNED_VOLUME_CC]);
    });
});
