import { beforeEach, describe, expect, it, vi } from 'vitest';

import { detachPatternInstance } from '../detachPatternInstance';

import type { Clip } from '../../../models/TrackViewTypes';

type TargetResolution =
    | { status: 'eligible'; trackId: string; clipId: string }
    | {
          status: 'missing' | 'ineligible';
      };

const mocks = vi.hoisted(() => {
    const trackStoreValue: { current: unknown } = { current: null };
    return {
        trackStoreValue,
        resolveEligibleClipWriteTarget: vi.fn<(input: { clipId: string }) => TargetResolution>(),
        updateClipInStore: vi.fn<(clipId: string, updater: (clip: Clip) => Clip) => boolean>(),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: {
        get value() {
            return mocks.trackStoreValue.current;
        },
    },
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
    updateClipInStore: mocks.updateClipInStore,
}));

function clip(overrides: Partial<Clip> = {}): Clip {
    return {
        id: 'instance-clip',
        trackId: 'midi-track',
        name: 'Instance',
        startBeat: 4,
        endBeat: 8,
        type: 'midi',
        fadeInBeats: 0.25,
        fadeOutBeats: 0.5,
        gain: 0.75,
        color: '#123456',
        locked: true,
        muted: true,
        ...overrides,
    };
}

function setClipOwner(ownedClip: Clip, kind = 'midi'): void {
    mocks.trackStoreValue.current = {
        tracks: [{ id: ownedClip.trackId, kind, clips: [ownedClip] }],
    };
}

describe('detachPatternInstance', () => {
    beforeEach(() => {
        mocks.trackStoreValue.current = null;
        mocks.resolveEligibleClipWriteTarget.mockReset();
        mocks.updateClipInStore.mockReset();
    });

    it('detaches an eligible linked instance and preserves every unrelated field', () => {
        const linked = clip({
            parentClipId: 'parent-clip',
            overrides: { notes: true },
            loopEnabled: true,
            loopLength: 4,
        });
        let updatedClip: Clip | undefined;
        setClipOwner(linked);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: linked.trackId,
            clipId: linked.id,
        });
        mocks.updateClipInStore.mockImplementation((_clipId, updater) => {
            updatedClip = updater(linked);
            return true;
        });

        const result = detachPatternInstance(linked.id);

        expect(result).toBe(true);
        expect(mocks.resolveEligibleClipWriteTarget).toHaveBeenCalledWith({ clipId: linked.id });
        expect(mocks.updateClipInStore).toHaveBeenCalledOnce();
        expect(updatedClip).toEqual({
            id: 'instance-clip',
            trackId: 'midi-track',
            name: 'Instance',
            startBeat: 4,
            endBeat: 8,
            type: 'midi',
            fadeInBeats: 0.25,
            fadeOutBeats: 0.5,
            gain: 0.75,
            color: '#123456',
            locked: true,
            muted: true,
            loopEnabled: true,
            loopLength: 4,
        });
        expect(mocks.resolveEligibleClipWriteTarget.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.updateClipInStore.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );
    });

    it('returns false when the accepted Arrangement update gateway reports no write', () => {
        const linked = clip({ parentClipId: 'parent-clip', overrides: {} });
        setClipOwner(linked);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: linked.trackId,
            clipId: linked.id,
        });
        mocks.updateClipInStore.mockReturnValue(false);

        expect(detachPatternInstance(linked.id)).toBe(false);
        expect(mocks.updateClipInStore).toHaveBeenCalledOnce();
    });

    it('rejects an eligible non-instance before invoking the Arrangement updater', () => {
        const independent = clip();
        setClipOwner(independent);
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: independent.trackId,
            clipId: independent.id,
        });

        expect(detachPatternInstance(independent.id)).toBe(false);
        expect(mocks.updateClipInStore).not.toHaveBeenCalled();
    });

    it.each([
        { name: 'missing clip', clipId: 'missing', status: 'missing', kind: 'midi' },
        { name: 'empty clip identity', clipId: '', status: 'ineligible', kind: 'midi' },
        { name: 'malformed owner', clipId: 'instance-clip', status: 'ineligible', kind: 'unexpected' },
        { name: 'runtime-VCA owner', clipId: 'instance-clip', status: 'ineligible', kind: 'vca' },
        { name: 'duplicate clip ownership', clipId: 'instance-clip', status: 'ineligible', kind: 'midi' },
    ] as const)('rejects a $name before invoking the Arrangement updater', (scenario) => {
        const linked = clip({ id: scenario.clipId, parentClipId: 'parent-clip', overrides: {} });
        const owner = { id: linked.trackId, kind: scenario.kind, clips: [linked] };
        mocks.trackStoreValue.current = {
            tracks: scenario.name === 'duplicate clip ownership' ? [owner, { ...owner, id: 'other-track' }] : [owner],
        };
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: scenario.status });

        expect(detachPatternInstance(scenario.clipId)).toBe(false);
        expect(mocks.resolveEligibleClipWriteTarget).toHaveBeenCalledWith({ clipId: scenario.clipId });
        expect(mocks.updateClipInStore).not.toHaveBeenCalled();
    });
});
