import { describe, it, expect, vi, beforeEach } from 'vitest';

import { detachPatternInstance } from '../detachPatternInstance';

import type { Clip } from '../../../models/TrackViewTypes';

const mocks = vi.hoisted(() => ({
    updateClipInStore: vi.fn<(clipId: string, updater: (clip: Clip) => Clip) => void>(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    updateClipInStore: mocks.updateClipInStore,
}));

function clip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'c1',
        trackId: 't1',
        name: 'Instance',
        startBeat: 4,
        endBeat: 8,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#fff',
        locked: false,
        muted: false,
        ...overrides,
    };
}

describe('detachPatternInstance', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to updateClipInStore for the given clip id', () => {
        detachPatternInstance('c1');

        expect(mocks.updateClipInStore).toHaveBeenCalledTimes(1);
        expect(mocks.updateClipInStore.mock.calls[0]?.[0]).toBe('c1');
    });

    it('strips parentClipId and overrides from a linked instance', () => {
        detachPatternInstance('c1');
        const updater = mocks.updateClipInStore.mock.calls[0]?.[1] as (clip: Clip) => Clip;

        const linked = clip({ parentClipId: 'parent-1', overrides: { notes: true } });
        const result = updater(linked);

        expect(result).not.toHaveProperty('parentClipId');
        expect(result).not.toHaveProperty('overrides');
        expect(result).toMatchObject({ id: 'c1', name: 'Instance' });
    });

    it('leaves a clip unchanged when it has no parentClipId (already independent)', () => {
        detachPatternInstance('c1');
        const updater = mocks.updateClipInStore.mock.calls[0]?.[1] as (clip: Clip) => Clip;

        const independent = clip();
        const result = updater(independent);

        expect(result).toBe(independent);
    });
});
