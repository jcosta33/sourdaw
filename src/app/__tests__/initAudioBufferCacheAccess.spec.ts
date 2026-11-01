import { describe, expect, it, vi } from 'vitest';

import { initAudioBufferCacheAccess } from '../initAudioBufferCacheAccess';

type TemporaryAsset = { assetId: string; status: 'live' | 'cleanup-pending' | 'released' };
type OwnershipCensus = { ids: readonly string[]; isCurrent: () => boolean };
type ReplayProvider = (entries: readonly unknown[]) => Promise<() => void>;

const registration = vi.hoisted(() => {
    const trackStore: { value: unknown } = { value: undefined };
    const agentRunStore: { value: { runs: { temporaryAssets: TemporaryAsset[] }[] } | undefined } = {
        value: undefined,
    };
    const isProjectCurrent = (): boolean => true;
    return {
        configureDurableOwnership: vi.fn<(provider: (() => Promise<OwnershipCensus>) | null) => void>(),
        configureLiveReferences: vi.fn<(reader: (() => readonly string[]) | null) => void>(),
        configureHistoryReferences: vi.fn<(reader: (() => ReadonlySet<string>) | null) => void>(),
        setReplayProvider: vi.fn<(provider: ReplayProvider | null) => void>(),
        prepareForReplay: vi.fn<(ids: readonly string[]) => Promise<() => void>>(),
        isProjectCurrent,
        collectDurableOwnedIds: vi.fn<() => Promise<OwnershipCensus>>(() =>
            Promise.resolve({ ids: ['saved-take'], isCurrent: isProjectCurrent })
        ),
        collectTrackStateIds: vi.fn<(value: unknown) => string[]>(() => ['referenced-take']),
        readUndoHistoryIds: vi.fn<() => ReadonlySet<string>>(() => new Set()),
        readUndoEntriesIds: vi.fn<(entries: readonly unknown[]) => ReadonlySet<string>>(() => new Set()),
        trackStore,
        agentRunStore,
    };
});

vi.mock('#/modules/AiRuntime/stores', () => ({ agentRunStore: registration.agentRunStore }));
vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: registration.trackStore }));
vi.mock('#/modules/Arrangement/useCases', () => ({
    readUndoEntriesAudioBufferIds: registration.readUndoEntriesIds,
    readUndoHistoryAudioBufferIds: registration.readUndoHistoryIds,
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    configureDurableAudioBufferOwnership: registration.configureDurableOwnership,
    configureHistoryAudioBufferReferences: registration.configureHistoryReferences,
    configureLiveAudioBufferReferences: registration.configureLiveReferences,
    prepareCachedAudioBuffersForReplay: registration.prepareForReplay,
}));
vi.mock('#/modules/Command/useCases', () => ({
    undoReplayPreparationPort: { setProvider: registration.setReplayProvider },
}));
vi.mock('#/modules/Project/useCases', () => ({
    collectDurableOwnedAudioBufferIds: registration.collectDurableOwnedIds,
    collectTrackStateAudioBufferIds: registration.collectTrackStateIds,
}));

function readRegistered<Value>(mock: { mock: { calls: Array<[Value | null]> }; mockClear: () => void }): Value {
    mock.mockClear();
    initAudioBufferCacheAccess();
    expect(mock.mock.calls).toHaveLength(1);
    const value = mock.mock.calls[0]?.[0];
    if (!value) {
        throw new Error('Expected a registration');
    }
    return value;
}

describe('initAudioBufferCacheAccess', () => {
    /**
     * AudioEngine's cache collectors must ask Project's persisted snapshots for
     * the durable owned-id set at collection time (#3777). The undo history owns
     * its buffers durably too (#6003): the cache evicts a history-only buffer once
     * it is stored, so a collector deleting that record would leave undo silent.
     */
    it('counts the undo history beside the persisted projects as durable owners', async () => {
        const provider = readRegistered(registration.configureDurableOwnership);
        registration.readUndoHistoryIds.mockReturnValueOnce(new Set(['deleted-take']));
        const census = await provider();
        expect(census.ids).toEqual(['saved-take', 'deleted-take']);
        expect(census.isCurrent).toBe(registration.isProjectCurrent);
    });

    /**
     * The runtime audio cache keeps resident every buffer the open arrangement
     * references, and only the composition root can hand it a reader over the
     * live track store. Dropping the registration, or reading anything but the
     * current track state, lets unrelated cache writes evict a session take.
     */
    it('wires the live audio buffer references to the current track state', () => {
        const reader = readRegistered(registration.configureLiveReferences);
        const trackState = { tracks: [] };
        registration.trackStore.value = trackState;
        expect(reader()).toEqual(['referenced-take']);
        expect(registration.collectTrackStateIds).toHaveBeenLastCalledWith(trackState);
    });

    /**
     * A clip deleted from the arrangement is still one undo away (#6003), but
     * the history has no cap: its ids reach the cache through the history
     * reader, which lets a durably stored buffer go, never through the live one.
     */
    it('hands the undo history to the history reader, not the live one', () => {
        const reader = readRegistered(registration.configureLiveReferences);
        registration.readUndoHistoryIds.mockReturnValue(new Set(['deleted-take']));
        try {
            expect(reader()).toEqual(['referenced-take']);
        } finally {
            registration.readUndoHistoryIds.mockReturnValue(new Set());
        }
        expect(readRegistered(registration.configureHistoryReferences)).toBe(registration.readUndoHistoryIds);
    });

    /**
     * Before an undo or redo applies, the buffers its entries name are put back
     * from storage and held until the replay settles; the provider must read the
     * ids of exactly the entries the replay runs and return the cache's release.
     */
    it('prepares the buffers of the entries an undo or redo replays', async () => {
        const provider = readRegistered(registration.setReplayProvider);
        const entries = [{ id: 'entry-1' }];
        const release = vi.fn();
        registration.readUndoEntriesIds.mockReturnValueOnce(new Set(['deleted-take']));
        registration.prepareForReplay.mockResolvedValueOnce(release);

        await expect(provider(entries)).resolves.toBe(release);
        expect(registration.readUndoEntriesIds).toHaveBeenCalledExactlyOnceWith(entries);
        expect(registration.prepareForReplay).toHaveBeenCalledExactlyOnceWith(['deleted-take']);
    });

    /**
     * A prepared stem import decodes into the cache long before the confirmed
     * import places its clips; the run's live temporary assets are what own it
     * until then, and a released asset owns nothing.
     */
    it('keeps an agent run’s unreleased temporary assets resident', () => {
        const reader = readRegistered(registration.configureLiveReferences);
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
