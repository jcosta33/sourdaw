import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';

import { createDefaultProductionBrief } from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { doesProductionBriefAllowActionBatch } from '../doesProductionBriefAllowActionBatch';

describe('production brief admission of an action no scope rule singles out', () => {
    beforeEach(() => {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            productionBrief: {
                ...createDefaultProductionBrief(100),
                locks: [
                    {
                        id: 'lock-range',
                        scope: { kind: 'range', startBeat: 50, endBeat: 60 },
                        statement: 'Keep this range',
                        createdAt: 111,
                    },
                ],
            },
        });
        setTrackStoreState({
            ...structuredClone(defaultTrackState),
            tracks: [createTrack({ id: 'track-guitar', name: 'Guitar', kind: 'audio' })],
        });
        addClip({
            id: 'clip-locked',
            trackId: 'track-guitar',
            name: 'Locked guitar',
            type: 'audio',
            startBeat: 50,
            endBeat: 60,
        });
        addClip({
            id: 'clip-free',
            trackId: 'track-guitar',
            name: 'Free guitar',
            type: 'audio',
            startBeat: 0,
            endBeat: 8,
        });
    });

    it('is refused when its payload names a clip inside the locked range', () => {
        expect(
            doesProductionBriefAllowActionBatch([
                { type: 'setClipColor', payload: { clipId: 'clip-locked', color: '#ff0000' } },
            ])
        ).toBe(false);
    });

    it('is allowed when its payload names a clip outside the locked range', () => {
        expect(
            doesProductionBriefAllowActionBatch([
                { type: 'setClipColor', payload: { clipId: 'clip-free', color: '#ff0000' } },
            ])
        ).toBe(true);
    });
});
