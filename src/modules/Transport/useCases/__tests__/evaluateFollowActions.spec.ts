import { describe, it, expect } from 'vitest';

import { type Track } from '#/modules/Arrangement/models/Track';

import { evaluateFollowActions } from '../evaluateFollowActions';

function makeClip(
    overrides: Partial<{ id: string; startBeat: number; endBeat: number; followAction: string; loopEnabled: boolean }>
) {
    return {
        id: 'c1',
        startBeat: 0,
        endBeat: 4,
        followAction: undefined,
        loopEnabled: false,
        ...overrides,
    } as never;
}

function makeTrack(clips: ReturnType<typeof makeClip>[]): Track {
    return { id: 't1', clips } as never;
}

describe('evaluateFollowActions', () => {
    it('returns no-op when no clips have follow actions', () => {
        const track = makeTrack([makeClip({ id: 'a' })]);
        const result = evaluateFollowActions([track], 0, 5);
        expect(result.shouldStop).toBe(false);
        expect(result.jumpToPosition).toBeNull();
    });

    it('does not trigger before the playhead crosses the clip end', () => {
        const track = makeTrack([makeClip({ id: 'a', endBeat: 8, followAction: 'stop' })]);
        const result = evaluateFollowActions([track], 0, 4);
        expect(result.shouldStop).toBe(false);
    });

    it('triggers stop when playhead crosses a clip end with stop action', () => {
        const track = makeTrack([makeClip({ id: 'a', endBeat: 4, followAction: 'stop' })]);
        const result = evaluateFollowActions([track], 3, 5);
        expect(result.shouldStop).toBe(true);
    });

    it('jumps to next clip on play_next action', () => {
        const track = makeTrack([
            makeClip({ id: 'a', startBeat: 0, endBeat: 4, followAction: 'play_next' }),
            makeClip({ id: 'b', startBeat: 8, endBeat: 12 }),
        ]);
        const result = evaluateFollowActions([track], 3, 5);
        expect(result.jumpToPosition).toBe(8);
    });

    it('jumps to first clip on play_first action', () => {
        const track = makeTrack([
            makeClip({ id: 'a', startBeat: 0, endBeat: 4 }),
            makeClip({ id: 'b', startBeat: 8, endBeat: 12, followAction: 'play_first' }),
        ]);
        const result = evaluateFollowActions([track], 11, 13);
        expect(result.jumpToPosition).toBe(0);
    });

    it('skips clips that have loopEnabled', () => {
        const track = makeTrack([makeClip({ id: 'a', endBeat: 4, followAction: 'stop', loopEnabled: true })]);
        const result = evaluateFollowActions([track], 3, 5);
        expect(result.shouldStop).toBe(false);
    });
});
