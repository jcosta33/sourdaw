import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { arrangementStore, defaultArrangementId, projectStore } from '#/modules/Project/stores';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { trackCommands } from '../TrackCommands';

const actionHarness = vi.hoisted(() => ({ opens: [] as Promise<void>[], decisions: [] as Promise<boolean>[] }));

// Observe the public dispatcher settling while retaining its real transaction and handlers.
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeUserAppAction: (...args: Parameters<typeof actual.executeUserAppAction>) => {
            const opening = actual.executeUserAppAction(...args);
            actionHarness.opens.push(opening);
            return opening;
        },
    };
});

vi.mock('#/utils/Notification/confirmUser', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/utils/Notification/confirmUser')>();
    return {
        ...actual,
        confirmUser: (...args: Parameters<typeof actual.confirmUser>) => {
            const decision = actual.confirmUser(...args);
            actionHarness.decisions.push(decision);
            return decision;
        },
    };
});

type Root = {
    tracks: { tracks: Track[] };
    takeLanes: NonNullable<typeof takeLaneStore.value>;
    actionHistory: NonNullable<typeof actionHistoryStore.value>;
};

function frozenTrack(id: string): Track {
    const track = createTrack({ id, name: `Frozen ${id}`, kind: 'midi' });
    const clip: Track['clips'][number] = {
        id: `clip-${id}`,
        trackId: id,
        name: 'Editable original',
        startBeat: 2,
        endBeat: 6,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 0.7,
        color: track.color,
        locked: false,
        muted: false,
    };
    return {
        ...track,
        clips: [clip],
        alternatives: [{ id: track.activeAlternativeId, name: 'Original', clips: [clip] }],
        frozen: true,
        frozenBufferId: `buffer-${id}`,
        freezeState: {
            status: 'frozen',
            freezeId: `take-${id}`,
            frozenBufferId: `buffer-${id}`,
            renderedAt: 123,
            renderSettings: { sampleRate: 48_000, bitDepth: 32, channelCount: 1, tailLengthSeconds: 0 },
        },
    };
}

function pcm(sample: number): AudioBuffer {
    const samples = new Float32Array(128).fill(sample);
    return {
        duration: samples.length / 48_000,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
        getChannelData: () => samples,
        copyFromChannel: (destination, _channel, start = 0) => {
            destination.set(samples.subarray(start, start + destination.length));
        },
        copyToChannel: (source, _channel, start = 0) => {
            samples.set(source, start);
        },
    };
}

function invokeFlatten(): void {
    const command = trackCommands.find((entry) => entry.id === 'flatten-track');
    if (!command || typeof command.action !== 'function') {
        throw new Error('Expected the real palette Flatten Track callable');
    }
    command.action();
}

function readTruth(): Root {
    flushAutomergeStorageWrites();
    const root = getCrdtDoc<Root>('root');
    if (!root) {
        throw new Error('Expected the canonical CRDT root');
    }
    return structuredClone({ tracks: root.tracks, takeLanes: root.takeLanes, actionHistory: root.actionHistory });
}

function changeOriginalTrack(update: (track: Track) => Track): void {
    const current = trackStore.value;
    if (!current) {
        throw new Error('Expected the live track projection');
    }
    trackStore.set({ ...current, tracks: current.tracks.map((track) => (track.id === 'a' ? update(track) : track)) });
    flushAutomergeStorageWrites();
}

async function activateProjectEpoch(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}

describe('palette Flatten Track confirmation through the real command and CRDT write path', () => {
    const notifications = createEventBus<{
        'ui.confirm': ConfirmPayload;
        'ui.notify': NotifyPayload;
        'ui.prompt': PromptPayload;
    }>();
    const confirmations: ConfirmPayload[] = [];
    const notices: NotifyPayload[] = [];
    let unsubscribeConfirm: () => void = () => undefined;
    let unsubscribeNotify: () => void = () => undefined;

    async function settleConfirmation(accepted: boolean): Promise<void> {
        const confirmation = confirmations.at(-1);
        const decision = actionHarness.decisions.at(-1);
        if (!confirmation || !decision) {
            throw new Error('Expected the actual ui.confirm request and pending decision');
        }
        confirmation.resolve(accepted);
        await decision;
        if (accepted) {
            const opening = actionHarness.opens.at(-1);
            if (!opening) {
                throw new Error('Accepted confirmation did not reach the public dispatcher');
            }
            await opening;
        }
    }

    function expectIntact(expected: Root): void {
        expect(readTruth()).toEqual(expected);
        expect(trackStore.value?.tracks).toEqual(expected.tracks.tracks);
        expect(takeLaneStore.value).toEqual(expected.takeLanes);
        expect(actionHistoryStore.value).toEqual(expected.actionHistory);
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        expect(notices.some((notice) => notice.level === 'success')).toBe(false);
    }

    beforeEach(async () => {
        Container.clear();
        setNotificationEventBus(notifications);
        confirmations.length = 0;
        notices.length = 0;
        actionHarness.opens.length = 0;
        actionHarness.decisions.length = 0;
        unsubscribeConfirm = notifications.on('ui.confirm', (payload) => {
            confirmations.push(payload);
        });
        unsubscribeNotify = notifications.on('ui.notify', (payload) => {
            notices.push(payload);
        });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        const handlers = getArrangementHandlers();
        registerHandlerMap({
            flattenTrack: handlers.flattenTrack,
            restoreTrackClipStates: handlers.restoreTrackClipStates,
            renameTrack: handlers.renameTrack,
            unfreezeTrack: handlers.unfreezeTrack,
        });
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearUndoHistory();
        clearActionHistory();
        trackStore.set({ tracks: [frozenTrack('a'), frozenTrack('b')], selectedTrackId: 'a' });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-a',
                    trackId: 'a',
                    takes: [
                        {
                            id: 'take-a',
                            clipId: 'clip-a',
                            name: 'Original take',
                            startBeat: 2,
                            endBeat: 6,
                            selected: true,
                        },
                    ],
                    activeCompRegions: [{ startBeat: 2, endBeat: 6, takeId: 'take-a' }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        audioBufferCache.set('buffer-a', pcm(0.25));
        audioBufferCache.set('buffer-b', pcm(0.5));
        arrangementStore.set({
            activeArrangementId: defaultArrangementId,
            arrangements: [
                {
                    id: defaultArrangementId,
                    name: 'Arrangement A',
                    tracks: { tracks: [], selectedTrackId: null },
                    automation: { lanes: [] },
                    midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                },
            ],
        });
        flushAutomergeStorageWrites();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
        await activateProjectEpoch();
    });

    afterEach(() => {
        unsubscribeConfirm();
        unsubscribeNotify();
        clearUndoHistory();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it('keeps editable originals, take lanes, and history intact while confirmation is pending and after cancellation', async () => {
        const original = readTruth();
        const originalStore = structuredClone(trackStore.value);
        invokeFlatten();
        await Promise.all(actionHarness.opens);

        expect(readTruth()).toEqual(original);
        expect(trackStore.value).toEqual(originalStore);
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        expect(confirmations).toHaveLength(1);
        const confirmation = confirmations[0]!;
        expect(confirmation).toMatchObject({
            title: 'Flatten "Frozen a"?',
            message:
                'Flatten replaces the editable clips and devices with one rendered audio clip. Undo before leaving this project if you want the originals back.',
            confirmLabel: 'Flatten',
            cancelLabel: 'Cancel',
            variant: 'danger',
        });
        expect(actionHarness.opens).toEqual([]);

        confirmation.resolve(false);
        await actionHarness.decisions[0];
        expect(readTruth()).toEqual(original);
        expect(trackStore.value).toEqual(originalStore);
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        expect(actionHarness.opens).toEqual([]);
        expect(notices).toEqual([]);
    });

    it('accepts once, commits the captured frozen PCM, and restores exact originals and output through Undo and Redo', async () => {
        const original = readTruth();
        const originalPcm = audioBufferCache.get('buffer-a');
        const handler = getArrangementHandlers().flattenTrack;
        const forward = vi.spyOn(handler, 'execute');
        invokeFlatten();
        const confirmation = confirmations[0]!;
        confirmation.resolve(true);
        confirmation.resolve(true);
        await settleConfirmation(true);

        expect(actionHarness.opens).toHaveLength(1);
        expect(forward).toHaveBeenCalledTimes(1);
        const flattened = readTruth();
        const flattenedTrack = flattened.tracks.tracks.find((track) => track.id === 'a');
        expect(flattenedTrack).toMatchObject({
            kind: 'audio',
            frozen: false,
            freezeState: { status: 'unfrozen' },
            devices: [],
        });
        expect(flattenedTrack?.clips).toHaveLength(1);
        expect(flattenedTrack?.clips[0]).toMatchObject({
            type: 'audio',
            audioBufferId: 'buffer-a',
            startBeat: 2,
            endBeat: 6,
        });
        expect(audioBufferCache.get('buffer-a')).toBe(originalPcm);
        expect(audioBufferCache.get('buffer-a')?.getChannelData(0)[0]).toBe(0.25);
        expect(flattened.tracks.tracks[1]).toEqual(original.tracks.tracks[1]);
        expect(flattened.takeLanes.lanes).toEqual([]);
        expect(flattened.actionHistory.entries).toHaveLength(1);
        expect(flattened.actionHistory.entries[0]).toMatchObject({
            actionKind: 'flattenTrack',
            label: 'Flatten track',
        });
        expect(trackStore.value?.tracks).toEqual(flattened.tracks.tracks);
        expect(takeLaneStore.value).toEqual(flattened.takeLanes);
        expect(actionHistoryStore.value).toEqual(flattened.actionHistory);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toEqual([]);

        expect((await undo()).headConsumed).toBe(true);
        const undone = readTruth();
        expect(undone.tracks).toEqual(original.tracks);
        expect(undone.takeLanes).toEqual(original.takeLanes);
        expect(trackStore.value?.tracks).toEqual(original.tracks.tracks);
        expect(takeLaneStore.value).toEqual(original.takeLanes);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(1);

        await redo();
        const redone = readTruth();
        expect(redone.tracks).toEqual(flattened.tracks);
        expect(redone.takeLanes).toEqual(flattened.takeLanes);
        expect(trackStore.value?.tracks).toEqual(flattened.tracks.tracks);
        expect(takeLaneStore.value).toEqual(flattened.takeLanes);
        expect(redone.actionHistory.entries).toHaveLength(1);
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(undoHistoryStore.value?.future).toEqual([]);
        expect(forward).toHaveBeenCalledTimes(1);
        expect(notices).toEqual([]);
    });

    it('does not request confirmation or dispatch when no track is selected', () => {
        const original = readTruth();
        trackStore.set({ ...trackStore.value!, selectedTrackId: null });
        invokeFlatten();
        expect(confirmations).toEqual([]);
        expect(actionHarness.opens).toEqual([]);
        expectIntact(original);
        expect(notices).toEqual([]);
    });

    it('keeps the named original target when the selected track changes while its dialog is open', async () => {
        const original = readTruth();
        invokeFlatten();
        trackStore.set({ ...trackStore.value!, selectedTrackId: 'b' });
        await settleConfirmation(true);
        const settled = readTruth();
        expect(settled.tracks.tracks[0]?.clips[0]?.audioBufferId).toBe('buffer-a');
        expect(settled.tracks.tracks[1]).toEqual(original.tracks.tracks[1]);
        expect(trackStore.value?.selectedTrackId).toBe('b');
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(actionHarness.opens).toHaveLength(1);
    });

    it.each<[string, (track: Track) => Track]>([
        [
            'frozen buffer',
            (track: Track) => ({
                ...track,
                freezeState: { ...track.freezeState, frozenBufferId: 'replacement-buffer' },
            }),
        ],
        [
            'freeze render id',
            (track: Track) => ({ ...track, freezeState: { ...track.freezeState, freezeId: 'replacement-render' } }),
        ],
        ['render timestamp', (track: Track) => ({ ...track, freezeState: { ...track.freezeState, renderedAt: 456 } })],
        ['unfrozen flag', (track: Track) => ({ ...track, frozen: false })],
        [
            'unfrozen state',
            (track: Track) => ({ ...track, freezeState: { ...track.freezeState, status: 'unfrozen' as const } }),
        ],
        [
            'stale freeze',
            (track: Track) => ({ ...track, freezeState: { ...track.freezeState, status: 'stale' as const } }),
        ],
        [
            'missing frozen buffer',
            (track: Track) => ({ ...track, freezeState: { ...track.freezeState, frozenBufferId: undefined } }),
        ],
        [
            'clip owner',
            (track: Track) => ({
                ...track,
                clips: track.clips.map((clip) => ({ ...clip, trackId: 'b' })),
            }),
        ],
    ])('refuses a changed %s at admission without writing or capturing an inverse', async (_label, update) => {
        const handler = getArrangementHandlers().flattenTrack;
        const describeAction = vi.spyOn(handler, 'describe');
        const forward = vi.spyOn(handler, 'execute');
        invokeFlatten();
        changeOriginalTrack(update);
        const changed = readTruth();
        await settleConfirmation(true);
        expectIntact(changed);
        expect(describeAction).not.toHaveBeenCalled();
        expect(forward).not.toHaveBeenCalled();
        expect(notices).toEqual([
            {
                message: 'The frozen track changed. Flatten was cancelled; check the track and try again.',
                level: 'warning',
            },
        ]);
    });

    it.each([false, true])(
        'refuses a deleted target, including same-ID recreation with a different frozen take: %s',
        async (recreate) => {
            invokeFlatten();
            const remaining = trackStore.value!.tracks.filter((track) => track.id !== 'a');
            trackStore.set({ tracks: remaining, selectedTrackId: 'b' });
            flushAutomergeStorageWrites();
            expect(readTruth().tracks.tracks.some((track) => track.id === 'a')).toBe(false);
            if (recreate) {
                const successor = frozenTrack('a');
                successor.freezeState = { ...successor.freezeState, freezeId: 'successor-take', renderedAt: 456 };
                trackStore.set({ tracks: [successor, ...remaining], selectedTrackId: 'a' });
            }
            const changed = readTruth();
            await settleConfirmation(true);
            expectIntact(changed);
            expect(notices).toEqual([
                {
                    message: 'The frozen track changed. Flatten was cancelled; check the track and try again.',
                    level: 'warning',
                },
            ]);
        }
    );

    it('refuses a successor project epoch even when the project ID and frozen take metadata are unchanged', async () => {
        const projectId = projectStore.value?.projectId;
        invokeFlatten();
        await activateProjectEpoch();
        expect(projectStore.value?.projectId).toBe(projectId);
        const changed = readTruth();
        await settleConfirmation(true);
        expectIntact(changed);
        expect(notices).toEqual([
            {
                message: 'The frozen track changed. Flatten was cancelled; check the track and try again.',
                level: 'warning',
            },
        ]);
    });

    it.each(['project epoch', 'frozen take', 'arrangement'] as const)(
        'checks %s again after a real queued Command transaction releases admission',
        async (change) => {
            const handler = getArrangementHandlers().flattenTrack;
            const describeAction = vi.spyOn(handler, 'describe');
            const forward = vi.spyOn(handler, 'execute');
            const entered = Promise.withResolvers<object>();
            const release = Promise.withResolvers<void>();
            const blockingTransaction = transactSnapshot(async (snapshotTransaction) => {
                await executeAppAction(
                    { type: 'renameTrack', payload: { trackId: 'b', name: 'Unrelated queued work' } },
                    { snapshotTransaction, skipUndo: true }
                );
                entered.resolve(snapshotTransaction);
                await release.promise;
            });
            const snapshotTransaction = await entered.promise;
            try {
                invokeFlatten();
                confirmations[0]!.resolve(true);
                await actionHarness.decisions[0];
                expect(actionHarness.opens).toHaveLength(1);
                expect(describeAction).not.toHaveBeenCalled();
                expect(forward).not.toHaveBeenCalled();
                expect(readTruth().tracks.tracks[0]?.frozen).toBe(true);
                expect(undoHistoryStore.value?.past).toEqual([]);
                let changed: Root;
                if (change === 'project epoch') {
                    await activateProjectEpoch();
                    changed = readTruth();
                } else if (change === 'frozen take') {
                    await executeAppAction(
                        { type: 'unfreezeTrack', payload: { trackId: 'a' } },
                        { snapshotTransaction, skipUndo: true }
                    );
                    changed = readTruth();
                } else {
                    changed = readTruth();
                    arrangementStore.set({ ...arrangementStore.value!, activeArrangementId: 'arrangement-b' });
                }
                release.resolve();
                await blockingTransaction;
                await actionHarness.opens[0];
                expectIntact(changed);
                expect(describeAction).not.toHaveBeenCalled();
                expect(forward).not.toHaveBeenCalled();
                expect(notices).toEqual([
                    {
                        message: 'The frozen track changed. Flatten was cancelled; check the track and try again.',
                        level: 'warning',
                    },
                ]);
            } finally {
                release.resolve();
                await blockingTransaction;
            }
        }
    );

    it('reports an unavailable frozen take without a confirmation, dispatch, or history entry', () => {
        changeOriginalTrack((track) => ({ ...track, freezeState: { status: 'frozen' } }));
        const original = readTruth();
        invokeFlatten();
        expect(confirmations).toEqual([]);
        expect(actionHarness.opens).toEqual([]);
        expectIntact(original);
        expect(notices).toEqual([
            { message: 'This frozen take is unavailable. Freeze the track again before flattening.', level: 'warning' },
        ]);
    });

    it('preserves originals and history when the actual frozen PCM is silent', async () => {
        audioBufferCache.set('buffer-a', pcm(0));
        const original = readTruth();
        const forward = vi.spyOn(getArrangementHandlers().flattenTrack, 'execute');
        invokeFlatten();
        await settleConfirmation(true);
        expect(forward).toHaveReturnedWith({ status: 'no-write' });
        expectIntact(original);
        expect(notices).toEqual([
            { message: expect.stringContaining('contains no audio. Flatten stopped'), level: 'error' },
        ]);
    });

    it('preserves canonical originals and history and visibly contains a rejected storage commit', async () => {
        const original = readTruth();
        const refusal = new Error('Palette Flatten storage commit refused');
        let refuseCommit = true;
        configureAutomergeStoragePort({
            getDoc: (id) => getCrdtDoc(id),
            getSemanticMessage: () => undefined,
            hasDoc: (id) => getCrdtDoc(id) !== undefined,
            mutateDoc: ({ docId, changeFn, message, snapshotTransaction, changedKeys }) => {
                if (refuseCommit) {
                    refuseCommit = false;
                    throw refusal;
                }
                mutateCrdtDoc({ id: docId, changeFn, message, snapshotTransaction, localSlots: changedKeys });
            },
        });
        invokeFlatten();
        await expect(settleConfirmation(true)).rejects.toBe(refusal);
        await vi.waitFor(() =>
            expect(notices).toEqual([
                { message: 'Flatten could not finish. Check the track before trying again.', level: 'error' },
            ])
        );
        expectIntact(original);
    });
});
