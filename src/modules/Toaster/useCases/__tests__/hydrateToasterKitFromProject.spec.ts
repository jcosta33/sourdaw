import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const trackStore = { value: null as { tracks: unknown[] } | null };
    return {
        fromToasterKitState: vi.fn(),
        trackStore,
    };
});

vi.mock('../../models/ToasterKitState', () => ({
    fromToasterKitState: mocks.fromToasterKitState,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
}));

import { hydrateToasterKitFromProject } from '../hydrateToasterKitFromProject';

const mockKit = { id: 'kit-result', pads: [] };

function makeTracks(devices: Array<{ id: string; deviceState?: unknown }>) {
    return [{ id: 'track-1', devices }];
}

describe('hydrateToasterKitFromProject', () => {
    it('returns null when the track store has no tracks (not hydrated)', () => {
        mocks.trackStore.value = null;

        const result = hydrateToasterKitFromProject('dev-1');

        expect(result).toBeNull();
        expect(mocks.fromToasterKitState).not.toHaveBeenCalled();
    });

    it('returns null when the device is not found in any track', () => {
        mocks.trackStore.value = { tracks: makeTracks([{ id: 'dev-other' }]) };

        const result = hydrateToasterKitFromProject('dev-missing');

        expect(result).toBeNull();
        expect(mocks.fromToasterKitState).not.toHaveBeenCalled();
    });

    it('returns null when the device exists but has no deviceState', () => {
        mocks.trackStore.value = { tracks: makeTracks([{ id: 'dev-1' }]) };

        const result = hydrateToasterKitFromProject('dev-1');

        expect(result).toBeNull();
        expect(mocks.fromToasterKitState).not.toHaveBeenCalled();
    });

    it('returns fromToasterKitState result when the device has deviceState', () => {
        mocks.trackStore.value = { tracks: makeTracks([{ id: 'dev-1', deviceState: { version: 1 } }]) };
        mocks.fromToasterKitState.mockReturnValue(mockKit);

        const result = hydrateToasterKitFromProject('dev-1');

        expect(result).toBe(mockKit);
        expect(mocks.fromToasterKitState).toHaveBeenCalledWith({ version: 1 });
    });

    it('finds the device across multiple tracks', () => {
        mocks.trackStore.value = {
            tracks: [
                { id: 'track-a', devices: [{ id: 'dev-x' }] },
                { id: 'track-b', devices: [{ id: 'dev-1', deviceState: { version: 2 } }] },
            ],
        };
        mocks.fromToasterKitState.mockReturnValue(mockKit);

        const result = hydrateToasterKitFromProject('dev-1');

        expect(result).toBe(mockKit);
        expect(mocks.fromToasterKitState).toHaveBeenCalledWith({ version: 2 });
    });

    it('finds the device among multiple devices on the same track', () => {
        mocks.trackStore.value = {
            tracks: makeTracks([{ id: 'dev-a' }, { id: 'dev-b' }, { id: 'dev-1', deviceState: { version: 3 } }]),
        };
        mocks.fromToasterKitState.mockReturnValue(mockKit);

        const result = hydrateToasterKitFromProject('dev-1');

        expect(result).toBe(mockKit);
        expect(mocks.fromToasterKitState).toHaveBeenCalledWith({ version: 3 });
    });
});
