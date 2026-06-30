import { describe, it, expect } from 'vitest';

import { evaluateFollowActions } from '../evaluateFollowActions';

type TestFollowAction = 'stop' | 'play_next' | 'play_previous' | 'play_random' | 'play_first' | 'play_last';

type TestClip = {
    id: string;
    startBeat: number;
    endBeat: number;
    followAction?: TestFollowAction;
    loopEnabled?: boolean;
};

type TestTrack = {
    clips: TestClip[];
};

function makeClip(overrides: Partial<TestClip> = {}): TestClip {
    return {
        id: 'c1',
        startBeat: 0,
        endBeat: 4,
        loopEnabled: false,
        ...overrides,
    };
}

function makeTrack(clips: TestClip[]): TestTrack {
    return { clips };
}

describe('evaluateFollowActions', () => {
    it('should return no-op when no clips have follow actions', () => {
        const track = makeTrack([makeClip({ id: 'a' })]);
        const result = evaluateFollowActions([track], 0, 5);
        expect(result.shouldStop).toBe(false);
        expect(result.jumpToPosition).toBeNull();
    });

    it('should not trigger before the playhead crosses the clip end', () => {
        const track = makeTrack([makeClip({ id: 'a', endBeat: 8, followAction: 'stop' })]);
        const result = evaluateFollowActions([track], 0, 4);
        expect(result.shouldStop).toBe(false);
        expect(result.jumpToPosition).toBeNull();
    });

    it('should trigger stop when playhead crosses a clip end with stop action', () => {
        const track = makeTrack([makeClip({ id: 'a', endBeat: 4, followAction: 'stop' })]);
        const result = evaluateFollowActions([track], 3, 5);
        expect(result.shouldStop).toBe(true);
        expect(result.jumpToPosition).toBeNull();
    });

    it('should jump to the nearest following clip on play_next action', () => {
        const track = makeTrack([
            makeClip({ id: 'a', startBeat: 0, endBeat: 4, followAction: 'play_next' }),
            makeClip({ id: 'b', startBeat: 12, endBeat: 16 }),
            makeClip({ id: 'c', startBeat: 8, endBeat: 12 }),
        ]);
        const result = evaluateFollowActions([track], 3, 5);
        expect(result.jumpToPosition).toBe(8);
        expect(result.shouldStop).toBe(false);
    });

    it('should jump to the nearest previous clip on play_previous action', () => {
        const track = makeTrack([
            makeClip({ id: 'a', startBeat: 0, endBeat: 4 }),
            makeClip({ id: 'b', startBeat: 2, endBeat: 7 }),
            makeClip({ id: 'c', startBeat: 6, endBeat: 10 }),
            makeClip({ id: 'd', startBeat: 12, endBeat: 16, followAction: 'play_previous' }),
        ]);
        const result = evaluateFollowActions([track], 15, 17);
        expect(result.jumpToPosition).toBe(6);
        expect(result.shouldStop).toBe(false);
    });

    it('should jump to the first clip on play_first action', () => {
        const track = makeTrack([
            makeClip({ id: 'a', startBeat: 0, endBeat: 4 }),
            makeClip({ id: 'b', startBeat: 8, endBeat: 12, followAction: 'play_first' }),
        ]);
        const result = evaluateFollowActions([track], 11, 13);
        expect(result.jumpToPosition).toBe(0);
        expect(result.shouldStop).toBe(false);
    });

    it('should jump to the last clip on play_last action', () => {
        const track = makeTrack([
            makeClip({ id: 'a', startBeat: 0, endBeat: 4, followAction: 'play_last' }),
            makeClip({ id: 'b', startBeat: 8, endBeat: 12 }),
            makeClip({ id: 'c', startBeat: 16, endBeat: 20 }),
        ]);
        const result = evaluateFollowActions([track], 3, 5);
        expect(result.jumpToPosition).toBe(16);
        expect(result.shouldStop).toBe(false);
    });

    it('should choose a deterministic target on play_random action', () => {
        const track = makeTrack([
            makeClip({ id: 'a', startBeat: 0, endBeat: 4, followAction: 'play_random' }),
            makeClip({ id: 'b', startBeat: 8, endBeat: 12 }),
            makeClip({ id: 'c', startBeat: 12, endBeat: 16 }),
            makeClip({ id: 'd', startBeat: 16, endBeat: 20 }),
        ]);
        const firstResult = evaluateFollowActions([track], 3, 5);
        const secondResult = evaluateFollowActions([track], 3, 5);
        expect(firstResult).toEqual(secondResult);
        expect(firstResult).toEqual({ jumpToPosition: 12, shouldStop: false });
    });

    it('should skip clips that have loopEnabled', () => {
        const track = makeTrack([makeClip({ id: 'a', endBeat: 4, followAction: 'stop', loopEnabled: true })]);
        const result = evaluateFollowActions([track], 3, 5);
        expect(result.shouldStop).toBe(false);
        expect(result.jumpToPosition).toBeNull();
    });
});
