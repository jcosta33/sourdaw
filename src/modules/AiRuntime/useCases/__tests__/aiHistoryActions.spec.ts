import { change, clone, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import * as automergeStorage from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers, setArrangementEventBus } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    clearHandlerRegistry,
    macroStore,
    registerHandlerMap,
    undoHistoryStore,
    undoTreeStore,
} from '#/modules/Command/stores';
import {
    captureUndoHistory,
    clearUndoHistory,
    executeAppAction,
    pushUndoEntry,
    redo,
    resetActionReplayAuthority,
    restoreUndoHistory,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    captureProjectIdentity,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import {
    aiActionHistoryStore,
    clearAiHistory,
    pushAiActionGroup,
    type AiActionGroup,
} from '../../stores/aiActionHistoryStore';
import { revertAiActionGroup } from '../aiHistoryActions';

import {
    configureAiWorkflowCommandPreflightFixture,
    resetAiWorkflowCommandPreflightFixture,
} from './aiWorkflowCommandPreflightFixture';

const runtimeMocks = vi.hoisted(() => ({ setTrackGain: vi.fn(), setTrackMute: vi.fn() }));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: runtimeMocks.setTrackGain,
    setTrackMute: runtimeMocks.setTrackMute,
    setTrackSoloGate: vi.fn(),
    resolveToasterPadBinding: () => null,
}));

vi.mock('#/modules/Routing/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Routing/useCases')>()),
    getAllSidechainRoutes: () => [],
}));

const notificationEventBus = {
    emit: vi.fn(() => Promise.resolve()),
    on: vi.fn(() => () => undefined),
};

function requireRoot() {
    const root = getCrdtDoc<Record<string, unknown>>('root');
    if (!root) {
        throw new Error('Expected the current project root');
    }
    return root;
}

function captureState() {
    flushAutomergeStorageWrites();
    return {
        project: toJS(requireRoot()),
        tracks: structuredClone(trackStore.value),
        undo: structuredClone(undoHistoryStore.value),
        tree: structuredClone(undoTreeStore.value),
        ai: structuredClone(aiActionHistoryStore.value),
    };
}

function expectRefusal(detail: string): void {
    expect(notificationEventBus.emit).toHaveBeenCalledWith(
        'ui.notify',
        expect.objectContaining({ level: 'warning', message: expect.stringContaining(detail) })
    );
}

function recordGroup(): AiActionGroup {
    const group: AiActionGroup = {
        id: 'ai-mix',
        prompt: 'Turn Keys down 2 dB and mute Bass',
        actions: [
            { kind: 'appAction', actionType: 'setTrackGain', label: 'Turn Keys down 2 dB' },
            { kind: 'appAction', actionType: 'muteTrack', label: 'Mute Bass' },
        ],
        groupId: 'ai-mix-group',
        timestamp: Date.now(),
        reverted: false,
        executionKind: 'project',
    };
    pushAiActionGroup(group);
    return group;
}

async function applyMix(): Promise<AiActionGroup> {
    const group = recordGroup();
    await executeAppAction(
        { type: 'setTrackGain', payload: { trackId: 'keys', deltaDb: -2, expectedGain: 1 } },
        { source: 'ai', groupId: group.groupId }
    );
    await executeAppAction(
        { type: 'muteTrack', payload: { trackId: 'bass', muted: true, expectedMuted: false } },
        { source: 'ai', groupId: group.groupId }
    );
    flushAutomergeStorageWrites();
    expect(undoHistoryStore.value?.past).toHaveLength(2);
    expect(trackStore.value?.tracks.find((track) => track.id === 'bass')?.muted).toBe(true);
    return group;
}

function holdRevertEffect(warning: boolean = false) {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const handlers = getArrangementHandlers();
    const waitForEffect = async () => {
        entered.resolve();
        await release.promise;
        if (warning) {
            throw new Error('Held revert follow-up unavailable');
        }
    };
    clearHandlerRegistry();
    registerHandlerMap({
        ...handlers,
        setTrackGain: {
            ...handlers.setTrackGain,
            execute: (action, context) => {
                const result = handlers.setTrackGain.execute(action, context);
                if (result instanceof Promise) {
                    throw new Error('Expected the track gain handler to execute synchronously');
                }
                if (result?.status !== 'written') {
                    return result;
                }
                return {
                    status: result.status,
                    reason: result.reason,
                    commitValidation: result.commitValidation,
                    postCommitEffect: result.postCommitEffect,
                    afterCommit: waitForEffect,
                    afterAmbiguousCommit: waitForEffect,
                };
            },
        },
    });
    return { entered: entered.promise, release: () => release.resolve() };
}

function failAfterProjectPublication(): () => void {
    const configuration = vi.spyOn(automergeStorage, 'configureAutomergeStoragePort');
    registerCrdtStorageRuntime();
    const port = configuration.mock.calls.at(-1)?.[0];
    configuration.mockRestore();
    if (!port) {
        throw new Error('Expected the production CRDT storage runtime');
    }
    configureAutomergeStoragePort({
        ...port,
        mutateDoc: (input) => {
            port.mutateDoc(input);
            throw new Error('Project published before observer failure');
        },
    });
    return () => configureAutomergeStoragePort(port);
}

describe('revertAiActionGroup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAiWorkflowCommandPreflightFixture();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('AI history revert test');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' }),
            clear: () => undefined,
        });
        clearAiHistory();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setNotificationEventBus(notificationEventBus);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: ['keys', 'bass', 'drums'].map((id) => ({
                ...createTrack({ id, name: id, kind: 'audio' }),
                gain: 1,
            })),
            selectedTrackId: null,
            ghostClips: [],
        });
        automationStore.set({ lanes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        flushAutomergeStorageWrites();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        setNotificationEventBus({ emit: () => Promise.resolve(), on: () => () => undefined });
        clearUndoHistory();
        resetAiWorkflowCommandPreflightFixture();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearAiHistory();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        transportStore.set(structuredClone(defaultTransportState));
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('reverts every member once, retains a later musician edit, and keeps the group redoable', async () => {
        const beforeMix = structuredClone(trackStore.value?.tracks);
        const group = await applyMix();
        const groupEntries = captureUndoHistory().past;
        await executeAppAction({ type: 'muteTrack', payload: { trackId: 'drums', muted: true, expectedMuted: false } });
        const musicianEntry = undoHistoryStore.value?.past.at(-1);

        await revertAiActionGroup(group);

        expect(trackStore.value?.tracks).toEqual(
            beforeMix?.map((track) => (track.id === 'drums' ? { ...track, muted: true } : track))
        );
        expect(undoHistoryStore.value?.past).toEqual([musicianEntry]);
        expect(undoHistoryStore.value?.future).toEqual(groupEntries);
        expect(aiActionHistoryStore.value?.groups).toEqual([{ ...group, reverted: true }]);
        expect(notificationEventBus.emit).not.toHaveBeenCalled();

        const reverted = captureState();
        await revertAiActionGroup(group);
        expect(captureState()).toEqual(reverted);
        expectRefusal('Nothing was undone');

        await redo();

        expect(trackStore.value?.tracks.find((track) => track.id === 'keys')?.gain).toBeCloseTo(10 ** (-2 / 20));
        expect(trackStore.value?.tracks.find((track) => track.id === 'bass')?.muted).toBe(true);
        expect(trackStore.value?.tracks.find((track) => track.id === 'drums')?.muted).toBe(true);
        expect(undoHistoryStore.value?.future).toEqual([]);
    });

    it('refuses a conflicting older inverse before the newer Bass inverse can write', async () => {
        const group = await applyMix();
        await executeAppAction({ type: 'removeTrack', payload: { trackId: 'keys' } });
        const beforeRevert = captureState();
        runtimeMocks.setTrackMute.mockClear();

        const failure: unknown = await revertAiActionGroup(group).catch((error: unknown) => error);

        expect(captureState()).toEqual(beforeRevert);
        expect(failure).toBeUndefined();
        expect(runtimeMocks.setTrackMute).not.toHaveBeenCalled();
        expectRefusal('Nothing was undone');
    });

    it('does not mark an absent undo group reverted', async () => {
        const group = recordGroup();
        const beforeRevert = captureState();

        await revertAiActionGroup(group);

        expect(captureState()).toEqual(beforeRevert);
        expectRefusal('applied whole');
    });

    it('does not consume or mark a partially undone group reverted', async () => {
        const group = await applyMix();
        const [keysEntry, bassEntry] = undoHistoryStore.value?.past ?? [];
        if (!keysEntry || !bassEntry) {
            throw new Error('Expected both real mix entries');
        }
        await executeAppAction(
            { type: 'muteTrack', payload: { trackId: 'bass', muted: false, expectedMuted: true } },
            { skipUndo: true }
        );
        undoHistoryStore.set({ past: [keysEntry], future: [bassEntry] });
        const beforeRevert = captureState();

        await revertAiActionGroup(group);

        expect(captureState()).toEqual(beforeRevert);
        expectRefusal('applied whole');
    });

    it('refuses a nonreplayable member without running its callback', async () => {
        const group = recordGroup();
        const undo = vi.fn();
        pushUndoEntry('Legacy change', undo, () => undefined, { source: 'ai', groupId: group.groupId });
        const beforeUndo = undoHistoryStore.value;
        const beforeAi = structuredClone(aiActionHistoryStore.value);

        await revertAiActionGroup(group);

        expect(undo).not.toHaveBeenCalled();
        expect(undoHistoryStore.value).toEqual(beforeUndo);
        expect(aiActionHistoryStore.value).toEqual(beforeAi);
        expectRefusal('inverse command');
    });

    it('keeps runtime-only history inert even when a project group shares its id', async () => {
        const group = await applyMix();
        const beforeRevert = captureState();

        await revertAiActionGroup({ ...group, executionKind: 'runtime' });

        expect(captureState()).toEqual(beforeRevert);
        expect(notificationEventBus.emit).not.toHaveBeenCalled();
    });

    it('settles a pre-existing queued selection without revoking an otherwise valid revert', async () => {
        const group = await applyMix();
        const tracks = trackStore.value;
        if (!tracks) {
            throw new Error('Expected the track projection');
        }
        trackStore.set({ ...tracks, selectedTrackId: 'keys' });

        await revertAiActionGroup(group);

        expect(trackStore.value?.selectedTrackId).toBe('keys');
        expect(trackStore.value?.tracks.find((track) => track.id === 'keys')?.gain).toBe(1);
        expect(trackStore.value?.tracks.find((track) => track.id === 'bass')?.muted).toBe(false);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(2);
        expect(aiActionHistoryStore.value?.groups).toEqual([{ ...group, reverted: true }]);
        expect(notificationEventBus.emit).not.toHaveBeenCalled();
    });

    it.each(['replacement', 'discarded history'] as const)(
        'refuses %s while atomic replay waits for a snapshot',
        async (transition) => {
            const group = await applyMix();
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const snapshot = transactSnapshot(async () => {
                entered.resolve();
                await release.promise;
            });
            await entered.promise;
            const originalProject = captureProjectIdentity();
            const beforeRevert = captureState();
            const wait = vi.spyOn(automergeStorage, 'waitForAutomergeSnapshotTransaction');
            const revert = revertAiActionGroup(group);
            try {
                await vi.waitFor(() => expect(wait).toHaveBeenCalled());
                const originalRoot = clone(requireRoot());
                if (transition === 'replacement') {
                    replaceCrdtDoc({ id: 'root', doc: originalRoot });
                    expect(captureProjectIdentity()).not.toBe(originalProject);
                } else {
                    replaceCrdtDocInLineage({
                        id: 'root',
                        doc: change(clone(originalRoot), (doc) => {
                            doc.temporaryEdit = true;
                        }),
                    });
                    replaceCrdtDocInLineage({ id: 'root', doc: originalRoot });
                    expect(captureProjectIdentity()).toBe(originalProject);
                }
            } finally {
                release.resolve();
            }
            await snapshot;
            await revert;

            expect(captureState()).toEqual(beforeRevert);
            expectRefusal('Nothing was undone');
        }
    );

    it.each([
        { transition: 'replacement', warning: false },
        { transition: 'same-lineage discard', warning: false },
        { transition: 'earlier snapshot', warning: false },
        { transition: 'unchanged', warning: false },
        { transition: 'replacement', warning: true },
    ])(
        'keeps history coherent during a post-commit $transition (warning: $warning)',
        async ({ transition, warning }) => {
            const group = await applyMix();
            const appliedRoot = clone(requireRoot());
            const originalProject = captureProjectIdentity();
            const entries = captureUndoHistory().past;
            const effect = holdRevertEffect(warning);
            const revert = revertAiActionGroup(group);
            await effect.entered;
            let beforeRelease: ReturnType<typeof captureState> | undefined;
            let historyAtCommit: typeof undoHistoryStore.value;
            try {
                expect(trackStore.value?.tracks.find((track) => track.id === 'keys')?.gain).toBe(1);
                expect(trackStore.value?.tracks.find((track) => track.id === 'bass')?.muted).toBe(false);
                expect(toJS(requireRoot())).toMatchObject({
                    tracks: {
                        tracks: expect.arrayContaining([
                            expect.objectContaining({ id: 'keys', gain: 1 }),
                            expect.objectContaining({ id: 'bass', muted: false }),
                        ]),
                    },
                });
                historyAtCommit = structuredClone(undoHistoryStore.value);
                if (transition === 'replacement') {
                    replaceCrdtDoc({ id: 'root', doc: clone(requireRoot()) });
                } else if (transition === 'same-lineage discard') {
                    replaceCrdtDocInLineage({ id: 'root', doc: appliedRoot });
                    expect(captureProjectIdentity()).toBe(originalProject);
                } else if (transition === 'earlier snapshot') {
                    replaceCrdtDoc({ id: 'root', doc: appliedRoot });
                }
                if (transition !== 'unchanged') {
                    clearUndoHistory();
                }
                beforeRelease = captureState();
            } finally {
                effect.release();
                await revert;
            }
            const after = captureState();
            expect({ ...after, ai: beforeRelease?.ai }).toEqual(beforeRelease);
            expect(historyAtCommit).toEqual({ past: [], future: entries });
            expect(aiActionHistoryStore.value?.groups).toEqual([{ ...group, reverted: true }]);
            if (warning) {
                expect(notificationEventBus.emit).toHaveBeenCalledWith(
                    'ui.notify',
                    expect.objectContaining({
                        level: 'warning',
                        message: expect.stringContaining('Held revert follow-up unavailable'),
                    })
                );
            } else {
                expect(notificationEventBus.emit).not.toHaveBeenCalled();
            }
        }
    );

    it('lets a musician edit during a committed effect clear the reverted group from Redo', async () => {
        const group = await applyMix();
        const entries = captureUndoHistory().past;
        const effect = holdRevertEffect();
        const revert = revertAiActionGroup(group);
        await effect.entered;
        let musicianEntry: NonNullable<typeof undoHistoryStore.value>['past'][number] | undefined;
        let historyAtCommit: typeof undoHistoryStore.value;
        try {
            historyAtCommit = structuredClone(undoHistoryStore.value);
            await executeAppAction({
                type: 'muteTrack',
                payload: { trackId: 'drums', muted: true, expectedMuted: false },
            });
            musicianEntry = undoHistoryStore.value?.past.at(-1);
        } finally {
            effect.release();
            await revert;
        }

        expect(historyAtCommit).toEqual({ past: [], future: entries });
        expect(undoHistoryStore.value).toEqual({ past: [musicianEntry], future: [] });
        expect(trackStore.value?.tracks.find((track) => track.id === 'keys')?.gain).toBe(1);
        expect(trackStore.value?.tracks.find((track) => track.id === 'bass')?.muted).toBe(false);
        expect(trackStore.value?.tracks.find((track) => track.id === 'drums')?.muted).toBe(true);
        expect(aiActionHistoryStore.value?.groups).toEqual([{ ...group, reverted: true }]);
        expect(notificationEventBus.emit).not.toHaveBeenCalled();
    });

    it.each(['cleared', 'restored copies', 'restored original entries', 'musician edit'] as const)(
        'preserves history changed during ambiguous reconciliation with %s history',
        async (transition) => {
            const group = await applyMix();
            const appliedRoot = clone(requireRoot());
            const snapshot = captureUndoHistory();
            const entries = [...snapshot.past];
            const effect = holdRevertEffect();
            const restorePort = failAfterProjectPublication();
            const revert = revertAiActionGroup(group);
            await effect.entered;
            let beforeRelease: ReturnType<typeof captureState> | undefined;
            let musicianEntry: NonNullable<typeof undoHistoryStore.value>['past'][number] | undefined;
            try {
                restorePort();
                expect(trackStore.value?.tracks.find((track) => track.id === 'keys')?.gain).toBe(1);
                expect(trackStore.value?.tracks.find((track) => track.id === 'bass')?.muted).toBe(false);
                expect(toJS(requireRoot())).toMatchObject({
                    tracks: {
                        tracks: expect.arrayContaining([
                            expect.objectContaining({ id: 'keys', gain: 1 }),
                            expect.objectContaining({ id: 'bass', muted: false }),
                        ]),
                    },
                });
                expect(undoHistoryStore.value?.future).toEqual(entries);
                if (transition === 'musician edit') {
                    await executeAppAction({
                        type: 'muteTrack',
                        payload: { trackId: 'drums', muted: true, expectedMuted: false },
                    });
                    musicianEntry = undoHistoryStore.value?.past.at(-1);
                    expect(undoHistoryStore.value?.past).toEqual([musicianEntry]);
                } else {
                    replaceCrdtDoc({ id: 'root', doc: appliedRoot });
                    clearUndoHistory();
                    if (transition === 'restored copies') {
                        const copies = structuredClone(snapshot);
                        restoreUndoHistory(copies);
                        expect(undoHistoryStore.value?.past[0]?.id).toBe(entries[0]?.id);
                        expect(undoHistoryStore.value?.past[0]).not.toBe(entries[0]);
                    } else if (transition === 'restored original entries') {
                        restoreUndoHistory(snapshot);
                        expect(undoHistoryStore.value?.past[0]).toBe(entries[0]);
                    }
                }
                beforeRelease = captureState();
            } finally {
                restorePort();
                effect.release();
                await revert;
            }

            const after = captureState();
            if (transition !== 'musician edit') {
                expect({ ...after, ai: beforeRelease?.ai }).toEqual(beforeRelease);
            } else {
                expect(after.undo).toEqual({ past: musicianEntry ? [musicianEntry] : [], future: [] });
                expect(after.project).toEqual(beforeRelease?.project);
                expect(after.tracks).toEqual(beforeRelease?.tracks);
            }
            expect(aiActionHistoryStore.value?.groups).toEqual([{ ...group, reverted: true }]);
            expect(notificationEventBus.emit).toHaveBeenCalledWith(
                'ui.notify',
                expect.objectContaining({
                    level: 'warning',
                    message: expect.stringContaining('Automerge storage transaction committed'),
                })
            );
        }
    );

    it('reports a committed warning while keeping the whole revert consumed', async () => {
        const group = await applyMix();
        const handlers = getArrangementHandlers();
        const failEffect = () => {
            throw new Error('Revert follow-up unavailable');
        };
        clearHandlerRegistry();
        registerHandlerMap({
            ...handlers,
            setTrackGain: {
                ...handlers.setTrackGain,
                execute: (action, context) => {
                    const result = handlers.setTrackGain.execute(action, context);
                    if (result instanceof Promise) {
                        throw new Error('Expected the track gain handler to execute synchronously');
                    }
                    if (result?.status !== 'written') {
                        return result;
                    }
                    return {
                        status: result.status,
                        reason: result.reason,
                        commitValidation: result.commitValidation,
                        postCommitEffect: result.postCommitEffect,
                        afterCommit: failEffect,
                        afterAmbiguousCommit: failEffect,
                    };
                },
            },
        });

        await expect(revertAiActionGroup(group)).resolves.toBeUndefined();

        expect(trackStore.value?.tracks.find((track) => track.id === 'keys')?.gain).toBe(1);
        expect(trackStore.value?.tracks.find((track) => track.id === 'bass')?.muted).toBe(false);
        expect(undoHistoryStore.value?.past).toEqual([]);
        expect(undoHistoryStore.value?.future).toHaveLength(2);
        expect(aiActionHistoryStore.value?.groups).toEqual([{ ...group, reverted: true }]);
        expect(notificationEventBus.emit).toHaveBeenCalledWith(
            'ui.notify',
            expect.objectContaining({
                level: 'warning',
                message: expect.stringContaining('Revert follow-up unavailable'),
            })
        );
    });

    it('reports an unexpected replay failure without abandoning a rejected UI promise', async () => {
        const group = await applyMix();
        clearHandlerRegistry();
        const beforeRevert = captureState();

        await expect(revertAiActionGroup(group)).resolves.toBeUndefined();

        expect(captureState()).toEqual(beforeRevert);
        expect(notificationEventBus.emit).toHaveBeenCalledWith(
            'ui.notify',
            expect.objectContaining({ level: 'error', message: expect.stringContaining('not completely registered') })
        );
    });
});
