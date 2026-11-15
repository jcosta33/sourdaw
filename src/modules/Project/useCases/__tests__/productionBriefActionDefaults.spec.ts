import { beforeEach, describe, expect, it } from 'vitest';

import { defaultTrackState } from '#/modules/Arrangement/stores';
import { addClip, createTrack, setTrackStoreState } from '#/modules/Arrangement/useCases';
import { type AppAction } from '#/utils/handlerContract';

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

    it.each([
        { clipId: 'clip-locked', allowed: false },
        { clipId: 'clip-free', allowed: true },
    ])('scope-checks the nested relink alias $clipId', ({ clipId, allowed }) => {
        const action: AppAction = {
            type: 'relinkClipAudioSources',
            payload: {
                targets: [
                    {
                        trackId: 'track-guitar',
                        trackKind: 'audio',
                        activeAlternativeId: 'active',
                        alternativeId: null,
                        clipId,
                        before: { audioBufferId: 'missing' },
                        after: { audioBufferId: 'replacement' },
                    },
                ],
            },
        };

        expect(doesProductionBriefAllowActionBatch([action])).toBe(allowed);
    });

    it('is refused when its type is unknown and its payload names a clip inside the locked range', () => {
        // A persisted batch is untrusted data: JSON.parse yields an untyped value, so no cast is needed.
        const actions: AppAction[] = JSON.parse('[{"type":"noSuchAction","payload":{"clipId":"clip-locked"}}]');

        expect(doesProductionBriefAllowActionBatch(actions)).toBe(false);
    });

    it('is allowed when its type is unknown and its payload names no clip and no beat', () => {
        const actions: AppAction[] = JSON.parse('[{"type":"noSuchAction","payload":{}}]');

        expect(doesProductionBriefAllowActionBatch(actions)).toBe(true);
    });

    it('is allowed when its type is an inherited object name and its payload is empty', () => {
        const actions: AppAction[] = JSON.parse('[{"type":"constructor","payload":{}}]');

        expect(doesProductionBriefAllowActionBatch(actions)).toBe(true);
    });

    it('is allowed under an object-scoped brief when its type is unknown and its payload is empty', () => {
        const current = projectStore.value!;
        projectStore.set({
            ...current,
            productionBrief: {
                ...current.productionBrief,
                locks: [
                    {
                        id: 'lock-object',
                        scope: { kind: 'object', objectType: 'clip', objectId: 'clip-locked' },
                        statement: 'Keep this clip',
                        createdAt: 112,
                    },
                ],
            },
        });
        const actions: AppAction[] = JSON.parse('[{"type":"toString","payload":{}}]');

        expect(doesProductionBriefAllowActionBatch(actions)).toBe(true);
    });
});
