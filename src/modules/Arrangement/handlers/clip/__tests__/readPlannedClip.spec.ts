import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { createTrack } from '../../../models/Track';
import { defaultTrackState, trackStore } from '../../../stores/trackStore';
import { audioSourceEditedEarlierInBatch, readPlannedClip } from '../readPlannedClip';

function context(prior: readonly AppAction[]) {
    const current: AppAction = { type: 'selectTrack', payload: { trackId: 'track-1' } };
    return { actions: [...prior, current], actionIndex: prior.length };
}

describe('readPlannedClip', () => {
    beforeEach(() => {
        const track = createTrack({ id: 'track-1', name: 'T', kind: 'midi', withoutDefaultDevice: true });
        const other = createTrack({ id: 'track-2', name: 'O', kind: 'midi', withoutDefaultDevice: true });
        trackStore.set({
            ...defaultTrackState,
            tracks: [
                { ...track, clips: [ClipDummy.create({ id: 'c1', trackId: 'track-1', type: 'midi', name: 'Old' })] },
                other,
            ],
        });
    });

    afterEach(() => {
        trackStore.set(structuredClone(defaultTrackState));
    });

    it('reads the clip as the store holds it when no batch context is given, and nothing for an unknown id', () => {
        expect(readPlannedClip('c1')?.name).toBe('Old');
        expect(readPlannedClip('missing')).toBeUndefined();
    });

    it('plans an earlier rename of the clip into the clip it returns', () => {
        const planned = readPlannedClip(
            'c1',
            context([{ type: 'renameClip', payload: { clipId: 'c1', name: 'New' } }])
        );

        expect(planned?.name).toBe('New');
    });

    it('ignores an earlier action that names neither the clip nor its track', () => {
        const planned = readPlannedClip(
            'c1',
            context([{ type: 'muteTrack', payload: { trackId: 'track-2', muted: true, expectedMuted: false } }])
        );

        expect(planned?.name).toBe('Old');
    });

    it('reads the clip as absent after an earlier action that names it among a list but is not projected', () => {
        const planned = readPlannedClip(
            'c1',
            context([
                {
                    type: 'moveClips',
                    payload: { moves: [{ clipId: 'c1', trackId: 'track-2', startBeat: 8 }], ripple: false },
                },
            ])
        );

        expect(planned).toBeUndefined();
    });

    it.each<{ name: string; action: AppAction }>([
        {
            name: 'a ripple move of another clip',
            action: {
                type: 'moveClips',
                payload: { moves: [{ clipId: 'other', trackId: 'track-1', startBeat: 8 }], ripple: true },
            },
        },
        {
            name: 'a ripple draw',
            action: {
                type: 'drawClip',
                payload: { trackId: 'track-1', startBeat: 0, endBeat: 2, name: 'Drawn', type: 'midi', ripple: true },
            },
        },
    ])('reads the clip as absent after $name that shifts it without naming it', ({ action }) => {
        expect(readPlannedClip('c1', context([action]))).toBeUndefined();
    });

    it('plans the clip where an earlier ripple removal of another clip leaves it', () => {
        trackStore.set({
            ...defaultTrackState,
            tracks: [
                {
                    ...createTrack({ id: 'track-1', name: 'T', kind: 'midi', withoutDefaultDevice: true }),
                    clips: [
                        ClipDummy.create({ id: 'c0', trackId: 'track-1', type: 'midi', startBeat: 0, endBeat: 4 }),
                        ClipDummy.create({ id: 'c1', trackId: 'track-1', type: 'midi', startBeat: 4, endBeat: 8 }),
                    ],
                },
            ],
        });

        const planned = readPlannedClip(
            'c1',
            context([{ type: 'removeClip', payload: { clipId: 'c0', ripple: true } }])
        );

        expect([planned?.startBeat, planned?.endBeat]).toEqual([0, 4]);
    });

    it('reads the clip as absent after an earlier action that rewrites clips without naming them', () => {
        const planned = readPlannedClip('c1', context([{ type: 'deleteTime', payload: { startBeat: 0, endBeat: 2 } }]));

        expect(planned).toBeUndefined();
    });
});

describe('audioSourceEditedEarlierInBatch', () => {
    it('is true only after an earlier nudge, trim or slip that names the clip', () => {
        expect(
            audioSourceEditedEarlierInBatch('c1', context([{ type: 'nudgeClip', payload: { clipId: 'c1', beats: 1 } }]))
        ).toBe(true);
        expect(
            audioSourceEditedEarlierInBatch(
                'c1',
                context([{ type: 'renameClip', payload: { clipId: 'c1', name: 'x' } }])
            )
        ).toBe(false);
        expect(
            audioSourceEditedEarlierInBatch(
                'c1',
                context([{ type: 'nudgeClip', payload: { clipId: 'other', beats: 1 } }])
            )
        ).toBe(false);
        expect(audioSourceEditedEarlierInBatch('c1')).toBe(false);
    });
});
