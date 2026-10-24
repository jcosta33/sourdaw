import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import { logger } from '#/infra/logger/appLogger';
import {
    AutomergeStorageWriteConflictError,
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    isAppActionConflictError,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore, agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectRevision,
    captureProjectRootIdentity,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    hasCrdtDoc,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
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
import { cancelFreezeTrack } from '../../../useCases/freezeBounce/cancelFreezeTrack';
import { captureFreezeStateSnapshot } from '../../../useCases/freezeBounce/freezeStateSnapshot';
import { activeFreezeTasks } from '../../../useCases/freezeBounce/freezeTrack';
import { type renderTrackOffline } from '../../../useCases/freezeBounce/renderOffline';
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
    const doc = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root');
    const track = doc?.tracks.tracks[0];
    if (!track) {
        throw new Error('Expected the seeded raw track');
    }
    return track;
}

function freeze(): Promise<void> {
    return executeAppAction({ type: 'freezeTrack', payload: { trackId: 'freeze-track' } });
}

describe('registered Freeze failure settlement', () => {
    let notices: NotifyPayload[];
    let onFailure: (() => void) | undefined;

    beforeEach(() => {
        notices = [];
        onFailure = undefined;
        const bus = createEventBus<{
            'ui.notify': NotifyPayload;
            'ui.confirm': ConfirmPayload;
            'ui.prompt': PromptPayload;
        }>();
        bus.on('ui.notify', (notice) => {
            notices.push(notice);
            onFailure?.();
        });
        setNotificationEventBus(bus);
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Freeze failure integration');
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
        actionHistoryStore.set({ entries: [] });
        macroStore.set({ macros: [], recording: true, currentRecording: [] });
        projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'freeze-track' })],
            selectedTrackId: 'freeze-track',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        render.mockReset();
        vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        agentProjectRepairStateStore.set(null);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearHandlerRegistry();
        activeFreezeTasks.clear();
    });

    function expectFailure(message: string): void {
        const expected = { status: 'error', errorMessage: message };
        expect.soft(rawTrack().freezeState).toEqual(expected);
        expect.soft(projectedTrack().freezeState).toEqual(expected);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(actionHistoryStore.value?.entries).toHaveLength(0);
        expect(getCrdtDoc<{ actionHistory: { entries: unknown[] } }>('root')?.actionHistory.entries).toHaveLength(0);
        expect(macroStore.value?.currentRecording).toHaveLength(0);
        expect(activeFreezeTasks.size).toBe(0);
    }

    function holdFailureSettlement() {
        const entered = Promise.withResolvers<object>();
        const release = Promise.withResolvers<void>();
        let transaction: ReturnType<typeof transactSnapshot> | undefined;
        onFailure = () => {
            onFailure = undefined;
            transaction = transactSnapshot(async (handle) => {
                entered.resolve(handle);
                await release.promise;
            });
        };
        return {
            entered: entered.promise,
            async finish() {
                release.resolve();
                await transaction;
            },
        };
    }

    it('commits a real renderer rejection without successful Freeze history', async () => {
        render.mockRejectedValue(new Error('Offline renderer refused the track'));
        await freeze();
        expect(render).toHaveBeenCalledTimes(1);
        expect(notices).toContainEqual({ message: 'Offline renderer refused the track', level: 'error' });
        expectFailure('Offline renderer refused the track');
    });

    it('commits the actual silent-bake refusal without successful Freeze history', async () => {
        render.mockImplementation(async (_track, _start, _end, options) => {
            options?.onScheduled?.({ scheduledNotes: 1, scheduledBuffers: [], withheldDeviceTypes: [] });
            return buffer(0);
        });
        await freeze();
        const message = notices[0]?.message;
        expect(message).toContain('rendered as digital silence');
        if (!message) {
            throw new Error('Expected the actual silent-bake notification');
        }
        expectFailure(message);
    });

    it('replaces the reason when a failed track is retried', async () => {
        render
            .mockRejectedValueOnce(new Error('First render refused'))
            .mockRejectedValueOnce(new Error('Second render refused'));
        await freeze();
        expectFailure('First render refused');
        await freeze();
        expectFailure('Second render refused');
        expect(render).toHaveBeenCalledTimes(2);
    });

    it('keeps the prior stale take and its metadata after a failed retry', async () => {
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
        trackStore.set({ tracks: [prior], selectedTrackId: prior.id });
        flushAutomergeStorageWrites();
        render.mockRejectedValue(new Error('Retry refused'));
        await freeze();
        for (const track of [rawTrack(), projectedTrack()]) {
            expect(track.frozen).toBe(true);
            expect(track.frozenBufferId).toBe('old-take');
            expect(track.freezeState).toEqual({ ...prior.freezeState, status: 'error', errorMessage: 'Retry refused' });
        }
        expect(undoStore.value?.past).toHaveLength(0);
        expect(macroStore.value?.currentRecording).toHaveLength(0);
    });

    it('keeps genuine successful Freeze undo and redo bound to the rendered take', async () => {
        render.mockResolvedValue(buffer(0.5));
        await freeze();
        const produced = captureFreezeStateSnapshot(rawTrack());
        expect(produced.freezeState.status).toBe('frozen');
        expect(captureFreezeStateSnapshot(projectedTrack())).toEqual(produced);
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(rawTrack().freezeState.status).toBe('unfrozen');
        expect(projectedTrack().freezeState.status).toBe('unfrozen');
        await redo();
        expect(captureFreezeStateSnapshot(rawTrack())).toEqual(produced);
        expect(captureFreezeStateSnapshot(projectedTrack())).toEqual(produced);
        expect(render).toHaveBeenCalledTimes(1);
    });

    it('recovers from a render failure with a retry whose Undo and Redo retain the original diagnostic', async () => {
        render.mockRejectedValueOnce(new Error('Initial render refused')).mockResolvedValueOnce(buffer(0.5));
        await freeze();
        expectFailure('Initial render refused');
        const failed = captureFreezeStateSnapshot(rawTrack());
        await freeze();
        const produced = captureFreezeStateSnapshot(rawTrack());
        expect(produced.freezeState.status).toBe('frozen');
        expect(captureFreezeStateSnapshot(projectedTrack())).toEqual(produced);
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        expect(captureFreezeStateSnapshot(rawTrack())).toEqual(failed);
        expect(captureFreezeStateSnapshot(projectedTrack())).toEqual(failed);
        await redo();
        expect(captureFreezeStateSnapshot(rawTrack())).toEqual(produced);
        expect(captureFreezeStateSnapshot(projectedTrack())).toEqual(produced);
        expect(render).toHaveBeenCalledTimes(2);
        expect(notices).toEqual([{ message: 'Initial render refused', level: 'error' }]);
        expect(activeFreezeTasks.size).toBe(0);
    });

    it('keeps successful render authority when a non-root document is added', async () => {
        const entered = Promise.withResolvers<void>();
        const rendered = Promise.withResolvers<AudioBuffer | null>();
        render.mockImplementation(() => {
            entered.resolve();
            return rendered.promise;
        });
        const pending = freeze();
        await entered.promise;
        const rootIdentity = captureProjectRootIdentity();
        const revision = captureProjectRevision();
        createCrdtDoc('unrelated-sync-document');
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        expect(captureProjectRevision()).not.toBe(revision);
        rendered.resolve(buffer(0.5));
        await pending;
        expect(rawTrack().freezeState.status).toBe('frozen');
        expect(projectedTrack().freezeState.status).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(1);
        expect(activeFreezeTasks.size).toBe(0);
    });

    it('keeps the complete failure revision fence when a non-root document is added', async () => {
        const entered = Promise.withResolvers<void>();
        const rendered = Promise.withResolvers<AudioBuffer | null>();
        render.mockImplementation(() => {
            entered.resolve();
            return rendered.promise;
        });
        const pending = freeze();
        await entered.promise;
        const rootIdentity = captureProjectRootIdentity();
        createCrdtDoc('unrelated-sync-document');
        expect(captureProjectRootIdentity()).toBe(rootIdentity);
        rendered.reject(new Error('Render refused after child sync'));
        await pending;
        expect(notices).toContainEqual({ message: 'Render refused after child sync', level: 'error' });
        expect(rawTrack().freezeState.status).toBe('unfrozen');
        expect(projectedTrack().freezeState.status).toBe('unfrozen');
        expect(undoStore.value?.past).toHaveLength(0);
        expect(actionHistoryStore.value?.entries).toHaveLength(0);
        expect(macroStore.value?.currentRecording).toHaveLength(0);
        expect(activeFreezeTasks.size).toBe(0);
    });

    it.each(['child-document', 'new-task', 'cancelled', 'changed-aggregate'] as const)(
        'withdraws failure authority after staging when %s changes before commit',
        async (mode) => {
            render.mockRejectedValue(new Error('Render refused before late change'));
            const changed = Promise.withResolvers<void>();
            const newerTask = new AbortController();
            const unsubscribe = trackStore.subscribe((state) => {
                if (state?.tracks[0]?.freezeState.status !== 'error') {
                    return;
                }
                unsubscribe();
                queueMicrotask(() => {
                    if (mode === 'child-document') {
                        createCrdtDoc('late-unrelated-sync-document');
                    } else if (mode === 'new-task') {
                        activeFreezeTasks.set('freeze-track', newerTask);
                    } else if (mode === 'cancelled') {
                        activeFreezeTasks.get('freeze-track')?.abort();
                    } else {
                        trackStore.set({
                            ...state,
                            tracks: state.tracks.map((track) => ({
                                ...track,
                                freezeState: { status: 'error', errorMessage: 'Newer diagnostic' },
                            })),
                        });
                    }
                    changed.resolve();
                });
            });
            try {
                await freeze();
                await changed.promise;
                expect(rawTrack().freezeState.status).toBe('unfrozen');
                if (mode === 'changed-aggregate') {
                    expect(projectedTrack().freezeState).toEqual({ status: 'error', errorMessage: 'Newer diagnostic' });
                } else {
                    expect(projectedTrack().freezeState).toEqual({ status: 'unfrozen' });
                }
                expect(undoStore.value?.past).toHaveLength(0);
                expect(actionHistoryStore.value?.entries).toHaveLength(0);
                expect(
                    getCrdtDoc<{ actionHistory: { entries: unknown[] } }>('root')?.actionHistory.entries
                ).toHaveLength(0);
                expect(macroStore.value?.currentRecording).toHaveLength(0);
                expect(activeFreezeTasks.get('freeze-track')).toBe(mode === 'new-task' ? newerTask : undefined);
                expect(notices).toEqual([{ message: 'Render refused before late change', level: 'error' }]);
            } finally {
                unsubscribe();
            }
        }
    );

    it('keeps a newer render task installed while the failed task awaits settlement', async () => {
        const hold = holdFailureSettlement();
        render.mockRejectedValue(new Error('Old render refused'));
        const pending = freeze();
        await hold.entered;
        const newerTask = new AbortController();
        activeFreezeTasks.set('freeze-track', newerTask);
        await hold.finish();
        await pending;
        expect(notices).toContainEqual({ message: 'Old render refused', level: 'error' });
        expect(activeFreezeTasks.get('freeze-track')).toBe(newerTask);
        expect(rawTrack().freezeState.status).toBe('unfrozen');
        expect(projectedTrack().freezeState.status).toBe('unfrozen');
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('does not settle a failure after the user cancels its waiting task', async () => {
        const hold = holdFailureSettlement();
        render.mockRejectedValue(new Error('Cancelled render refused'));
        const pending = freeze();
        await hold.entered;
        cancelFreezeTrack('freeze-track');
        await hold.finish();
        await pending;
        expect(rawTrack().freezeState.status).toBe('unfrozen');
        expect(projectedTrack().freezeState.status).toBe('unfrozen');
        expect(activeFreezeTasks.size).toBe(0);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('reports both failures when project repair withdraws settlement admission', async () => {
        const hold = holdFailureSettlement();
        const renderFailure = new Error('Unsettled render refused');
        render.mockRejectedValue(renderFailure);
        const pending = freeze();
        await hold.entered;
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'repair-revision',
            inspectionAvailable: true,
            projectInvariantsValid: true,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });
        await hold.finish();
        await expect(pending).resolves.toBeUndefined();
        expect(notices).toEqual([
            { message: 'Unsettled render refused', level: 'error' },
            {
                message:
                    'Freeze failed: Unsettled render refused. Could not save the failure diagnostic: Action conflicts with current project state: restoreFreezeState',
                level: 'error',
            },
        ]);
        const aggregates = vi
            .mocked(logger.error)
            .mock.calls.map(([error]) => error)
            .filter((error) => error instanceof AggregateError);
        expect(aggregates).toHaveLength(1);
        expect(aggregates[0]?.errors[0]).toBe(renderFailure);
        expect(isAppActionConflictError(aggregates[0]?.errors[1])).toBe(true);
        expect(actionHistoryStore.value?.entries).toHaveLength(0);
        expect(getCrdtDoc<{ actionHistory: { entries: unknown[] } }>('root')?.actionHistory.entries).toHaveLength(0);
        expect(macroStore.value?.currentRecording).toHaveLength(0);
        expect(rawTrack().freezeState.status).toBe('unfrozen');
        expect(projectedTrack().freezeState.status).toBe('unfrozen');
        expect(undoStore.value?.past).toHaveLength(0);
        expect(activeFreezeTasks.size).toBe(0);
    });

    it('keeps a replacement project even when it reuses the old timestamp and track id', async () => {
        const hold = holdFailureSettlement();
        render.mockRejectedValue(new Error('Outgoing render refused'));
        const pending = freeze();
        const handle = await hold.entered;
        resetCrdtProjectAuthority('Incoming project');
        const seed = runWithAutomergeStorageTransaction(handle, () => {
            projectStore.set({ ...defaultProjectStoreState, createdAt: 100, updatedAt: 100, loading: false });
            trackStore.set({
                tracks: [TrackDummy.create({ id: 'freeze-track', name: 'Incoming track' })],
                selectedTrackId: 'freeze-track',
            });
        });
        if (seed.status === 'threw') {
            throw seed.error;
        }
        seed.commit();
        await hold.finish();
        await pending;
        expect(rawTrack().name).toBe('Incoming track');
        expect(projectedTrack().name).toBe('Incoming track');
        expect(rawTrack().freezeState.status).toBe('unfrozen');
        expect(projectedTrack().freezeState.status).toBe('unfrozen');
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('keeps a newer freeze aggregate committed while failure settlement waits', async () => {
        const hold = holdFailureSettlement();
        render.mockRejectedValue(new Error('Old render refused'));
        const pending = freeze();
        const snapshotTransaction = await hold.entered;
        await executeAppAction(
            {
                type: 'restoreFreezeState',
                payload: {
                    trackId: 'freeze-track',
                    expected: captureFreezeStateSnapshot(projectedTrack()),
                    replacement: {
                        frozen: true,
                        frozenBufferId: 'newer-take',
                        freezeState: { status: 'frozen', freezeId: 'newer-freeze', frozenBufferId: 'newer-take' },
                    },
                },
            },
            { snapshotTransaction, skipUndo: true, skipMacroRecording: true }
        );
        await hold.finish();
        await pending;
        expect(rawTrack().frozenBufferId).toBe('newer-take');
        expect(projectedTrack().frozenBufferId).toBe('newer-take');
        expect(rawTrack().freezeState.status).toBe('frozen');
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it.each(['removed', 'recreated'] as const)('does not publish into a track %s during settlement', async (mode) => {
        const hold = holdFailureSettlement();
        render.mockRejectedValue(new Error('Deleted render refused'));
        const pending = freeze();
        const snapshotTransaction = await hold.entered;
        const replacement = TrackDummy.create({
            id: 'freeze-track',
            name: 'Replacement track',
            freezeState: projectedTrack().freezeState,
        });
        mutateCrdtDoc<{ tracks: { tracks: Track[] } }>({
            id: 'root',
            snapshotTransaction,
            changeFn: (doc) => {
                doc.tracks.tracks = mode === 'removed' ? [] : [replacement];
            },
        });
        trackStore.hydrate();
        await hold.finish();
        await pending;
        const tracks = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks;
        expect(tracks).toHaveLength(mode === 'removed' ? 0 : 1);
        expect(trackStore.value?.tracks).toHaveLength(mode === 'removed' ? 0 : 1);
        if (mode === 'recreated') {
            expect(rawTrack().name).toBe('Replacement track');
            expect(rawTrack().freezeState).toEqual(replacement.freezeState);
            expect(projectedTrack().freezeState).toEqual(replacement.freezeState);
        }
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it.each(['commit-error', 'write-conflict'] as const)(
        'handles an error settlement %s and reports both faults without successful Freeze',
        async (mode) => {
            // Inject only the storage port's commit fault; reads still use the actual
            // CRDT repository and the transaction/abort path remains production code.
            let failure = new Error('Failure settlement commit refused');
            if (mode === 'write-conflict') {
                failure = new AutomergeStorageWriteConflictError('Failure settlement conflict');
            }
            onFailure = () => {
                onFailure = undefined;
                configureAutomergeStoragePort({
                    getDoc: (id) => getCrdtDoc<Record<string, unknown>>(id),
                    hasDoc: hasCrdtDoc,
                    getSemanticMessage: () => undefined,
                    mutateDoc: () => {
                        throw failure;
                    },
                });
            };
            const renderFailure = new Error('Render refused');
            render.mockRejectedValue(renderFailure);
            await expect(freeze()).resolves.toBeUndefined();
            const settlementMessage =
                mode === 'commit-error'
                    ? failure.message
                    : 'Action conflicts with current project state: restoreFreezeState';
            expect(notices).toEqual([
                { message: 'Render refused', level: 'error' },
                {
                    message: `Freeze failed: Render refused. Could not save the failure diagnostic: ${settlementMessage}`,
                    level: 'error',
                },
            ]);
            const aggregates = vi
                .mocked(logger.error)
                .mock.calls.map(([error]) => error)
                .filter((error) => error instanceof AggregateError);
            expect(aggregates).toHaveLength(1);
            expect(aggregates[0]?.errors[0]).toBe(renderFailure);
            if (mode === 'commit-error') {
                expect(aggregates[0]?.errors[1]).toBe(failure);
            } else {
                expect(isAppActionConflictError(aggregates[0]?.errors[1])).toBe(true);
            }
            expect(actionHistoryStore.value?.entries).toHaveLength(0);
            expect(getCrdtDoc<{ actionHistory: { entries: unknown[] } }>('root')?.actionHistory.entries).toHaveLength(
                0
            );
            registerCrdtStorageRuntime();
            expect(rawTrack().freezeState.status).toBe('unfrozen');
            expect(projectedTrack().freezeState.status).toBe('unfrozen');
            expect(undoStore.value?.past).toHaveLength(0);
            expect(macroStore.value?.currentRecording).toHaveLength(0);
            expect(activeFreezeTasks.size).toBe(0);
        }
    );
});
