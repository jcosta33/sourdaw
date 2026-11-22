import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { logger } from '#/infra/logger/appLogger';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import {
    setNotificationEventBus,
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Track } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { captureFreezeStateSnapshot } from '../../../useCases/freezeBounce/freezeStateSnapshot';
import { activeFreezeTasks } from '../../../useCases/freezeBounce/freezeTrack';
import { type renderTrackOffline } from '../../../useCases/freezeBounce/renderOffline';
import { settledBeforeFreeze } from '../../../useCases/freezeBounce/settledBeforeFreeze';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';

const render = vi.hoisted(() => vi.fn<typeof renderTrackOffline>());
vi.mock('../../../useCases/freezeBounce/renderOffline', () => ({ renderTrackOffline: render }));

function buffer(value: number): AudioBuffer {
    const samples = new Float32Array(128).fill(value);
    return {
        duration: samples.length / 48000,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 48000,
        getChannelData: () => samples,
        copyFromChannel: (destination) => {
            destination.set(samples.subarray(0, destination.length));
        },
        copyToChannel: (source) => {
            samples.set(source.subarray(0, samples.length));
        },
    };
}

function projectedTrack(): Track {
    const track = trackStore.value?.tracks[0];
    if (!track) {
        throw new Error('Expected the seeded track projection');
    }
    return track;
}

function rawTrack(): Track {
    const track = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks[0];
    if (!track) {
        throw new Error('Expected the seeded raw track');
    }
    return track;
}

function freeze(): Promise<void> {
    return executeAppAction({ type: 'freezeTrack', payload: { trackId: 'freeze-track' } });
}

function seedTrack(track: Track): void {
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    flushAutomergeStorageWrites();
}

// The first render stays open until released; every later render resolves at once, so the second freeze
// supersedes the first and commits while the first is still rendering.
function holdFirstRender() {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<AudioBuffer | null>();
    render.mockImplementationOnce(() => {
        entered.resolve();
        return release.promise;
    });
    render.mockResolvedValue(buffer(0.5));
    return { entered: entered.promise, release: () => release.resolve(buffer(0.25)) };
}

async function freezeOverRunningFreeze(): Promise<void> {
    const first = holdFirstRender();
    const running = freeze();
    await first.entered;
    expect(projectedTrack().freezeState.status).toBe('freezing');
    await freeze();
    expect(projectedTrack().freezeState.status).toBe('frozen');
    first.release();
    await running;
}

describe('freezeTrack started over a running freeze', () => {
    beforeEach(() => {
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        setNotificationEventBus(bus);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Freeze over running freeze');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        activeFreezeTasks.clear();
        settledBeforeFreeze.clear();
        actionHistoryStore.set({ entries: [] });
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        seedTrack(TrackDummy.create({ id: 'freeze-track' }));
        render.mockReset();
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
        activeFreezeTasks.clear();
        settledBeforeFreeze.clear();
    });

    it('undoes a plain freeze to unfrozen and redoes it to the rendered take', async () => {
        render.mockResolvedValue(buffer(0.5));
        await freeze();
        const produced = captureFreezeStateSnapshot(rawTrack());
        expect(produced.freezeState.status).toBe('frozen');
        await undo();
        expect(rawTrack().freezeState.status).toBe('unfrozen');
        expect(rawTrack().frozen).toBe(false);
        await redo();
        expect(captureFreezeStateSnapshot(rawTrack())).toEqual(produced);
    });

    it('undoes to unfrozen, never freezing, when the first freeze of a fresh track was still running', async () => {
        await freezeOverRunningFreeze();
        expect(undoStore.value?.past).toHaveLength(1);
        const produced = captureFreezeStateSnapshot(rawTrack());
        expect(produced.freezeState.status).toBe('frozen');
        await undo();
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.freezeState.status).toBe('unfrozen');
            expect(track.frozen).toBe(false);
        }
        await redo();
        expect(captureFreezeStateSnapshot(rawTrack())).toEqual(produced);
    });

    it('undoes to the carried stale take when a refresh was still running', async () => {
        const prior = TrackDummy.create({
            id: 'freeze-track',
            frozen: true,
            frozenBufferId: 'old-take',
            freezeState: {
                status: 'stale',
                freezeId: 'old-freeze',
                frozenBufferId: 'old-take',
                sourceContentHash: 'old-hash',
                compensationSeconds: 0.02,
            },
        });
        seedTrack(prior);
        await freezeOverRunningFreeze();
        await undo();
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.frozen).toBe(true);
            expect(track.frozenBufferId).toBe('old-take');
            expect(track.freezeState).toEqual(prior.freezeState);
        }
    });

    it('undoes to the exact error prior when a freeze over a running freeze of an errored track commits', async () => {
        const prior = TrackDummy.create({
            id: 'freeze-track',
            freezeState: { status: 'error', errorMessage: 'Render failed: out of memory' },
        });
        seedTrack(prior);
        await freezeOverRunningFreeze();
        await undo();
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.frozen).toBe(false);
            expect(track.freezeState).toEqual({ status: 'error', errorMessage: 'Render failed: out of memory' });
        }
    });

    it('undoes to unfrozen when the track arrives freezing from a collaborator with no local freeze running', async () => {
        seedTrack(
            TrackDummy.create({
                id: 'freeze-track',
                freezeState: { status: 'freezing', freezeId: 'remote-freeze', renderProgress: 0.4 },
            })
        );
        expect(settledBeforeFreeze.has('freeze-track')).toBe(false);
        render.mockResolvedValue(buffer(0.5));
        await freeze();
        expect(projectedTrack().freezeState.status).toBe('frozen');
        await undo();
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.frozen).toBe(false);
            expect(track.freezeState).toEqual({ status: 'unfrozen' });
        }
    });

    it('undoes to the stale take when the collaborator freezing the track carried a take', async () => {
        seedTrack(
            TrackDummy.create({
                id: 'freeze-track',
                frozen: true,
                frozenBufferId: 'old-take',
                freezeState: {
                    status: 'freezing',
                    freezeId: 'remote-freeze',
                    frozenBufferId: 'old-take',
                    renderProgress: 0.4,
                },
            })
        );
        render.mockResolvedValue(buffer(0.5));
        await freeze();
        await undo();
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.frozen).toBe(true);
            expect(track.frozenBufferId).toBe('old-take');
            expect(track.freezeState).toEqual({
                status: 'stale',
                freezeId: 'remote-freeze',
                frozenBufferId: 'old-take',
            });
        }
    });

    it('keeps a track unfrozen when its render finishes after an unfreeze, committing and caching no take', async () => {
        const first = holdFirstRender();
        const running = freeze();
        await first.entered;
        await executeAppAction({ type: 'unfreezeTrack', payload: { trackId: 'freeze-track' } });
        expect(activeFreezeTasks.has('freeze-track')).toBe(false);
        expect(settledBeforeFreeze.has('freeze-track')).toBe(false);
        first.release();
        await running;
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.freezeState).toEqual({ status: 'unfrozen' });
            expect(track.frozen).toBe(false);
            expect(track.frozenBufferId).toBeUndefined();
        }
        expect(render.mock.calls[0]?.[3]?.abortSignal?.aborted).toBe(true);
    });

    it('unfreezes a committed frozen track as before, with nothing running', async () => {
        render.mockResolvedValue(buffer(0.5));
        await freeze();
        expect(projectedTrack().freezeState.status).toBe('frozen');
        await executeAppAction({ type: 'unfreezeTrack', payload: { trackId: 'freeze-track' } });
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.freezeState).toEqual({ status: 'unfrozen' });
            expect(track.frozen).toBe(false);
        }
    });

    it('settles a track left freezing when the batch holding its unfreeze is rolled back', async () => {
        const first = holdFirstRender();
        const running = freeze();
        await first.entered;
        await expect(
            executeAppAction(
                { type: 'unfreezeTrack', payload: { trackId: 'freeze-track' } },
                { shouldCommit: () => false }
            )
        ).rejects.toThrow();
        // The abort is not transactional: the rollback puts the document back to freezing with no task.
        expect(projectedTrack().freezeState.status).toBe('freezing');
        expect(activeFreezeTasks.has('freeze-track')).toBe(false);
        first.release();
        await running;
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.freezeState).toEqual({ status: 'unfrozen' });
        }
    });

    it('undoes an unfreeze issued while a freeze renders to unfrozen, never freezing', async () => {
        const first = holdFirstRender();
        const running = freeze();
        await first.entered;
        expect(projectedTrack().freezeState.status).toBe('freezing');
        await executeAppAction({ type: 'unfreezeTrack', payload: { trackId: 'freeze-track' } });
        expect(projectedTrack().freezeState.status).toBe('unfrozen');
        await undo();
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.freezeState.status).not.toBe('freezing');
        }
        first.release();
        await running;
    });
});
