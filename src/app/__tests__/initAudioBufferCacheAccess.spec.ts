import { describe, expect, it, vi } from 'vitest';

import { initAudioBufferCacheAccess } from '../initAudioBufferCacheAccess';

type TemporaryAsset = { assetId: string; status: 'live' | 'cleanup-pending' | 'released' };

const registration = vi.hoisted(() => {
    const trackStore: { value: unknown } = { value: undefined };
    const agentRunStore: { value: { runs: { temporaryAssets: TemporaryAsset[] }[] } | undefined } = {
        value: undefined,
    };
    return {
        configureDurableOwnership: vi.fn(),
        configureLiveReferences: vi.fn<(reader: (() => readonly string[]) | null) => void>(),
        collectDurableOwnedIds: vi.fn<() => Promise<readonly string[]>>(() => Promise.resolve([])),
        collectTrackStateIds: vi.fn<(value: unknown) => string[]>(() => ['referenced-take']),
        readUndoHistoryIds: vi.fn<() => ReadonlySet<string>>(() => new Set()),
        trackStore,
        agentRunStore,
    };
});

vi.mock('#/modules/AiRuntime/stores', () => ({ agentRunStore: registration.agentRunStore }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: registration.trackStore }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    readUndoHistoryAudioBufferIds: registration.readUndoHistoryIds,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    configureDurableAudioBufferOwnership: registration.configureDurableOwnership,
    configureLiveAudioBufferReferences: registration.configureLiveReferences,
}));
vi.mock('#/modules/Project/useCases', () => ({
    collectDurableOwnedAudioBufferIds: registration.collectDurableOwnedIds,
    collectTrackStateAudioBufferIds: registration.collectTrackStateIds,
}));

function readRegisteredReader(): () => readonly string[] {
    registration.configureLiveReferences.mockClear();
    initAudioBufferCacheAccess();
    expect(registration.configureLiveReferences).toHaveBeenCalledOnce();
    const reader = registration.configureLiveReferences.mock.calls[0]?.[0];
    if (!reader) {
        throw new Error('Expected a live audio buffer reference reader');
    }
    return reader;
}

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
        const reader = readRegisteredReader();
        const trackState = { tracks: [] };
        registration.trackStore.value = trackState;
        expect(reader()).toEqual(['referenced-take']);
        expect(registration.collectTrackStateIds).toHaveBeenLastCalledWith(trackState);
    });

    /**
     * A clip deleted from the arrangement is still one undo away (#6003): the
     * reader must add what the history can restore, read fresh on every call
     * so a cleared or trimmed history stops protecting it.
     */
    it('keeps buffers the undo history can restore resident while the history holds them', () => {
        const reader = readRegisteredReader();
        registration.readUndoHistoryIds.mockReturnValueOnce(new Set(['deleted-take']));
        expect(reader()).toEqual(['referenced-take', 'deleted-take']);
        expect(reader()).toEqual(['referenced-take']);
    });

    /**
     * A prepared stem import decodes into the cache long before the confirmed
     * import places its clips; the run's live temporary assets are what own it
     * until then, and a released asset owns nothing.
     */
    it('keeps an agent run’s unreleased temporary assets resident', () => {
        const reader = readRegisteredReader();
        registration.agentRunStore.value = {
            runs: [
                {
                    temporaryAssets: [
                        { assetId: 'prepared-stem', status: 'live' },
                        { assetId: 'stem-cleanup-pending', status: 'cleanup-pending' },
                        { assetId: 'placed-stem', status: 'released' },
                    ],
                },
            ],
        };
        try {
            expect(reader()).toEqual(['referenced-take', 'prepared-stem', 'stem-cleanup-pending']);
        } finally {
            registration.agentRunStore.value = undefined;
        }
    });
});
