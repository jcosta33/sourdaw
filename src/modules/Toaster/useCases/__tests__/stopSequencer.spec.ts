import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const toasterStore = {
        value: {} as Record<string, { isPlaying: boolean; currentStep: number; kit: string }>,
        set: vi.fn(),
    };
    return {
        getSequencerPlaybackState: vi.fn(),
        releaseToasterNotes: vi.fn(),
        toasterStore,
    };
});

vi.mock('../getSequencerPlaybackState', () => ({
    getSequencerPlaybackState: mocks.getSequencerPlaybackState,
}));

vi.mock('../releaseToasterNotes', () => ({
    releaseToasterNotes: mocks.releaseToasterNotes,
}));

vi.mock('../../stores/toasterStore', () => ({
    toasterStore: mocks.toasterStore,
}));

import { stopSequencer } from '../stopSequencer';

type SeqState = {
    running: boolean;
    timeoutId: ReturnType<typeof setTimeout> | null;
    preScheduledStep: number | null;
    playCount: number;
    lastBpm: number | null;
};

function makeSeqState(overrides?: Partial<SeqState>): SeqState {
    return {
        running: true,
        timeoutId: 99999 as never,
        preScheduledStep: 3,
        playCount: 5,
        lastBpm: 120,
        ...overrides,
    };
}

describe('stopSequencer', () => {
    let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
        mocks.toasterStore.value = {};
    });

    it('sets running to false and clears the timeout', () => {
        const seqState = makeSeqState();
        mocks.getSequencerPlaybackState.mockReturnValue(seqState);

        stopSequencer('dev-1');

        expect(seqState.running).toBe(false);
        expect(seqState.timeoutId).toBeNull();
        expect(clearTimeoutSpy).toHaveBeenCalledWith(99999);
    });

    it('releases all active notes for the device', () => {
        const seqState = makeSeqState();
        mocks.getSequencerPlaybackState.mockReturnValue(seqState);

        stopSequencer('dev-1');

        expect(mocks.releaseToasterNotes).toHaveBeenCalledWith('dev-1');
    });

    it('resets preScheduledStep, playCount, and lastBpm', () => {
        const seqState = makeSeqState();
        mocks.getSequencerPlaybackState.mockReturnValue(seqState);

        stopSequencer('dev-1');

        expect(seqState.preScheduledStep).toBeNull();
        expect(seqState.playCount).toBe(0);
        expect(seqState.lastBpm).toBeNull();
    });

    it('updates the store: isPlaying false, currentStep 0', () => {
        const seqState = makeSeqState();
        mocks.getSequencerPlaybackState.mockReturnValue(seqState);
        mocks.toasterStore.value = {
            'dev-1': { isPlaying: true, currentStep: 7, kit: 'default' },
        };

        stopSequencer('dev-1');

        expect(mocks.toasterStore.set).toHaveBeenCalledTimes(1);
        const newState = mocks.toasterStore.set.mock.calls[0]?.[0];
        expect(newState['dev-1'].isPlaying).toBe(false);
        expect(newState['dev-1'].currentStep).toBe(0);
        // Kit data preserved.
        expect(newState['dev-1'].kit).toBe('default');
    });

    it('does not write to the store when the device has no state', () => {
        const seqState = makeSeqState();
        mocks.getSequencerPlaybackState.mockReturnValue(seqState);
        mocks.toasterStore.value = {};

        stopSequencer('dev-missing');

        expect(mocks.toasterStore.set).not.toHaveBeenCalled();
    });

    it('does not clear a timeout when timeoutId is already null', () => {
        const seqState = makeSeqState({ timeoutId: null });
        mocks.getSequencerPlaybackState.mockReturnValue(seqState);

        stopSequencer('dev-1');

        expect(clearTimeoutSpy).not.toHaveBeenCalled();
    });
});
