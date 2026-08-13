import { beforeEach, describe, expect, it, vi } from 'vitest';

import { midiLearnStore } from '../../../stores/midiLearnStore';
import { completeMidiLearn } from '../completeMidiLearn';

const dispatched: { type: string; payload: unknown }[] = [];

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: (action: { type: string; payload: unknown }) => {
        dispatched.push(action);
        return Promise.resolve();
    },
}));

describe('completeMidiLearn', () => {
    beforeEach(() => {
        dispatched.length = 0;
        midiLearnStore.set({ mappingsSchemaVersion: 1, mappings: [], isLearning: false, learningTarget: null });
    });

    it('does not dispatch when the store is not currently learning (audit A-1)', () => {
        completeMidiLearn(0, 7);

        expect(dispatched).toEqual([]);
    });

    it('dispatches completeMidiLearn with the channel/cc and a fresh mapping id when armed', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        completeMidiLearn(1, 74);

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]).toMatchObject({ type: 'completeMidiLearn', payload: { channel: 1, cc: 74 } });
        const payload = dispatched[0]?.payload as { mappingId: string };
        expect(typeof payload.mappingId).toBe('string');
        expect(payload.mappingId.length).toBeGreaterThan(0);
    });

    it('does not mutate midiLearnStore directly — the write belongs to handleCompleteMidiLearn', () => {
        midiLearnStore.set({
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: true,
            learningTarget: { targetType: 'trackGain', trackId: 'track1' },
        });

        completeMidiLearn(1, 74);

        expect(midiLearnStore.value?.mappings).toEqual([]);
        expect(midiLearnStore.value?.isLearning).toBe(true);
    });
});
