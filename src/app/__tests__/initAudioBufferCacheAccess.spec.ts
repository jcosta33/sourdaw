import { describe, expect, it, vi } from 'vitest';

import { initAudioBufferCacheAccess } from '../initAudioBufferCacheAccess';

const registration = vi.hoisted(() => {
    const trackStore: { value: unknown } = { value: undefined };
    return {
        configureDurableOwnership: vi.fn(),
        configureLiveReferences: vi.fn<(reader: (() => readonly string[]) | null) => void>(),
        collectDurableOwnedIds: vi.fn<() => Promise<readonly string[]>>(() => Promise.resolve([])),
        collectTrackStateIds: vi.fn<(value: unknown) => string[]>(() => ['referenced-take']),
        trackStore,
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: registration.trackStore }));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    configureDurableAudioBufferOwnership: registration.configureDurableOwnership,
    configureLiveAudioBufferReferences: registration.configureLiveReferences,
}));
vi.mock('#/modules/Project/useCases', () => ({
    collectDurableOwnedAudioBufferIds: registration.collectDurableOwnedIds,
    collectTrackStateAudioBufferIds: registration.collectTrackStateIds,
}));

describe('initAudioBufferCacheAccess', () => {
    /**
     * AudioEngine's cache collectors must ask Project's persisted snapshots for
     * the durable owned-id set at collection time (#3777), and AudioEngine
     * cannot import Project, so the composition root is the only place that
     * binding can be made. Pinned by reference like the other seam wirings:
     * dropping the registration, or handing the seam some other function,
     * leaves the collectors sweeping saved projects' PCM as if it were orphans.
     */
    it('wires the durable audio ownership provider to the persisted-project enumeration', () => {
        registration.configureDurableOwnership.mockClear();
        initAudioBufferCacheAccess();
        expect(registration.configureDurableOwnership).toHaveBeenCalledExactlyOnceWith(
            registration.collectDurableOwnedIds
        );
    });

    /**
     * The runtime audio cache keeps resident every buffer the open arrangement
     * references, and only the composition root can hand it a reader over the
     * live track store. Dropping the registration, or reading anything but the
     * current track state, lets unrelated cache writes evict a session take.
     */
    it('wires the live audio buffer references to the current track state', () => {
        registration.configureLiveReferences.mockClear();
        initAudioBufferCacheAccess();
        expect(registration.configureLiveReferences).toHaveBeenCalledOnce();
        const reader = registration.configureLiveReferences.mock.calls[0]?.[0];
        const trackState = { tracks: [] };
        registration.trackStore.value = trackState;
        expect(reader?.()).toEqual(['referenced-take']);
        expect(registration.collectTrackStateIds).toHaveBeenLastCalledWith(trackState);
    });
});
