import { clone as cloneAutomergeDoc, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import * as automergeStorage from '#/infra/store/storage/createAutomergeStorage';
import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { activeRecordingRef, takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { stageRecordingTake } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, undoHistoryStore, undoTreeStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { actionHistoryStore, branchStore } from '#/modules/CrdtDocument/stores';
import {
    DOC_PREFIX_ROOT,
    captureProjectRootIdentity,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { recordingLifecycle } from '../recordingLifecycle';
import { toggleRecording } from '../toggleRecording';

const TRACK_ID = 'track-recording';
const SESSION_KEY = 'sourdaw-undo-session';
type RecordingTerminal = (result: { kind: 'completed'; buffer: { duration: number } } | { kind: 'failed' }) => void;
const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0.125, outputLatency: 0 };
    let terminal: RecordingTerminal | null = null;
    return {
        audioClock,
        getAudioContext: vi.fn(() => audioClock),
        getCompensationDelay: vi.fn(() => 0),
        cacheAudioBuffer: vi.fn(),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        startPlayback: vi.fn<(onRoll?: (contextSeconds: number, beat: number) => void) => Promise<void>>(
            async (onRoll) => {
                onRoll?.(audioClock.currentTime, 4);
            }
        ),
        startAudioRecording: vi.fn<(trackId: string, callback: RecordingTerminal) => Promise<boolean>>(
            (_trackId, callback) => {
                terminal = callback;
                return Promise.resolve(true);
            }
        ),
        stopAudioRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        releaseTerminal(result: Parameters<RecordingTerminal>[0]): void {
            if (!terminal) {
                throw new Error('No actual production callback was registered');
            }
            const callback = terminal;
            terminal = null;
            callback(result);
        },
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: mocks.getAudioContext,
    getCompensationDelay: mocks.getCompensationDelay,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
}));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

// No commitRecording, executeAppAction, CRDT repository, storage runtime,
// transaction barrier, root witness or handler is mocked in this integration.
function recordingTrack(kind: 'audio' | 'midi'): Track {
    return {
        id: TRACK_ID,
        name: kind === 'audio' ? 'Audio' : 'Midi',
        kind,
        muted: false,
        soloed: false,
        armed: true,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((_resolve) => {
        resolve = _resolve;
    });
    return { promise, resolve };
}
function state() {
    const root = getCrdtDoc(DOC_PREFIX_ROOT);
    return structuredClone({
        identity: captureProjectRootIdentity(),
        root: root === undefined ? undefined : toJS(root),
        tracks: trackStore.value,
        takes: takeLaneStore.value,
        durableHistory: actionHistoryStore.value,
        history: undoHistoryStore.value,
        tree: undoTreeStore.value,
        mirror: sessionStorage.getItem(SESSION_KEY),
        warnings: mocks.notifyUser.mock.calls,
        cacheCalls: mocks.cacheAudioBuffer.mock.calls.length,
        pendingWrites: countPendingAutomergeStorageWrites(),
        settled: recordingLifecycle.settledCommitCount,
    });
}
async function settle() {
    flushAutomergeStorageWrites();
    await vi.waitFor(() => {
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        // The session contract can omit internal recording commands. Observe its
        // real mirror without assuming every live entry is serializable.
        expect(Array.isArray(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '{}').past)).toBe(true);
    });
}
async function startGesture() {
    trackStore.set({ tracks: [recordingTrack('audio')], selectedTrackId: TRACK_ID, ghostClips: [] });
    takeLaneStore.set({ lanes: [] });
    transportStore.set({
        ...defaultTransportState,
        tempo: 120,
        isPlaying: false,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: false,
        playheadPosition: 4,
    });
    tempoMapStore.set({ changes: [] });
    flushAutomergeStorageWrites();
    toggleRecording();
    await vi.waitFor(() => {
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(mocks.startAudioRecording).toHaveBeenCalledExactlyOnceWith(TRACK_ID, expect.any(Function), null);
    });
    await settle();
}
function committedCount() {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    ).length;
}
async function heldCapture(replaceRoot: boolean) {
    await startGesture();
    const initial = state();
    const root = getCrdtDoc(DOC_PREFIX_ROOT);
    if (!root) {
        throw new Error('Expected outgoing root');
    }
    const forkedProvisional = cloneAutomergeDoc(root);
    const entered = deferred();
    const held = deferred();
    const waiting = deferred();
    let waitEntries = 0;
    let transactionReleased = false;
    let waitEnteredWhileHeld = false;
    let realWaitSettled = false;
    const realWait = automergeStorage.waitForAutomergeSnapshotTransaction;
    const spy = vi.spyOn(automergeStorage, 'waitForAutomergeSnapshotTransaction').mockImplementation((transaction) => {
        waitEntries++;
        waitEnteredWhileHeld = !transactionReleased;
        waiting.resolve();
        const actual = realWait(transaction);
        void actual.then(() => {
            realWaitSettled = true;
        });
        return actual;
    });
    // Intentionally holds an active snapshot without reserving or dirtying root.
    // This real queue blocks every unowned action, while root installation is
    // still admitted by the repository's document-specific overlap rule.
    const snapshotTransaction = transactSnapshot(async () => {
        entered.resolve();
        await held.promise;
    });
    await entered.promise;
    try {
        const settledBefore = recordingLifecycle.settledCommitCount;
        mocks.releaseTerminal({ kind: 'completed', buffer: { duration: 2 } });
        await waiting.promise;
        expect(waitEntries).toBe(1);
        expect(waitEnteredWhileHeld).toBe(true);
        expect(realWaitSettled).toBe(false);
        expect(committedCount()).toBe(0);
        expect(recordingLifecycle.isClosingRecording()).toBe(true);
        // Audio capture placement is genuinely before executeAppAction's wait.
        // Flush it on the outgoing root, then install the original provisional
        // successor so stale queued writes cannot manufacture the counterexample.
        flushAutomergeStorageWrites();
        if (replaceRoot) {
            replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: forkedProvisional });
            projectCrdtToStores({ resetProjections: true });
        }
        await settle();
        const beforeRelease = state();
        expect(realWaitSettled).toBe(false);
        expect(beforeRelease.identity === initial.identity).toBe(!replaceRoot);
        transactionReleased = true;
        held.resolve();
        await snapshotTransaction;
        await vi.waitFor(() => {
            expect(recordingLifecycle.isClosingRecording()).toBe(false);
            expect(recordingLifecycle.settledCommitCount).toBe(settledBefore + 1);
        });
        await settle();
        const after = state();
        return { beforeRelease, after };
    } finally {
        transactionReleased = true;
        held.resolve();
        await snapshotTransaction;
        spy.mockRestore();
    }
}

function replaceRoot(): void {
    const root = getCrdtDoc(DOC_PREFIX_ROOT);
    if (!root) {
        throw new Error('Expected outgoing root');
    }
    replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
    projectCrdtToStores({ resetProjections: true });
}

function expectSuccessorUnchanged(before: ReturnType<typeof state>): void {
    const after = state();
    expect(after.identity).toBe(before.identity);
    expect(after.root).toEqual(before.root);
    expect(after.tracks).toEqual(before.tracks);
    expect(after.takes).toEqual(before.takes);
    expect(after.durableHistory).toEqual(before.durableHistory);
    expect(after.history).toEqual(before.history);
    expect(after.tree).toEqual(before.tree);
    expect(after.mirror).toEqual(before.mirror);
}

describe('recording terminal through the real snapshot queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recording terminal real queue');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        branchStore.set({
            branches: [
                {
                    branchId: 'main',
                    name: 'Main',
                    rootDocId: DOC_PREFIX_ROOT,
                    sourceBranchId: null,
                    createdAt: 1,
                    createdFromHeads: [],
                    note: '',
                },
            ],
            activeBranchId: 'main',
        });
        clearHandlerRegistry();
        sessionStorage.removeItem(SESSION_KEY);
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        actionHistoryStore.set({ entries: [] });
        const tree = undoTreeStore.value;
        if (!tree) {
            throw new Error('Expected undo tree');
        }
        undoTreeStore.set({ ...tree, enabled: true });
        activeRecordingRef.current = [];
        activeRecordingRef.capturedRootIdentity = null;
        mocks.audioClock.currentTime = 0;
    });
    afterEach(async () => {
        await settle();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        activeRecordingRef.current = [];
        activeRecordingRef.capturedRootIdentity = null;
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
    it('positive control: same-root audio capture genuinely waits and then commits once', async () => {
        const { beforeRelease, after } = await heldCapture(false);
        expect(beforeRelease.history?.past).toEqual([]);
        expect(after.history?.past).toHaveLength(1);
        expect(after.durableHistory?.entries).toHaveLength(1);
        expect(after.tracks?.tracks[0]?.clips[0]).toMatchObject({
            startBeat: 3.75,
            endBeat: 7.75,
            audioBufferId: expect.stringMatching(/^rec-/),
        });
        expect(after.warnings).toEqual([]);
    });
    it('replaced-root audio capture must preserve the successor after actually waiting', async () => {
        const { beforeRelease, after } = await heldCapture(true);
        expect(after.root, 'real terminal commit resumed after wait and altered successor raw CRDT').toEqual(
            beforeRelease.root
        );
        expect(after.tracks).toEqual(beforeRelease.tracks);
        expect(after.takes).toEqual(beforeRelease.takes);
        expect(after.durableHistory).toEqual(beforeRelease.durableHistory);
        expect(after.history).toEqual(beforeRelease.history);
        expect(after.tree).toEqual(beforeRelease.tree);
        expect(after.mirror).toEqual(beforeRelease.mirror);
        expect(after.warnings).toContainEqual([expect.stringContaining('not kept'), 'warning']);
    });
    it('preserves copied passes when the root moves before the queued commit is invoked', async () => {
        await startGesture();
        const clip = trackStore.value?.tracks[0]?.clips[0];
        if (!clip) {
            throw new Error('Expected provisional audio clip');
        }
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: clip.id,
            name: 'Take 2',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 0,
        });
        await settle();
        const settledBefore = recordingLifecycle.settledCommitCount;
        mocks.releaseTerminal({ kind: 'completed', buffer: { duration: 2 } });
        // The terminal queued a continuation but it has not invoked the real
        // commit, whose capture placement would otherwise write these passes.
        replaceRoot();
        const before = state();
        expect(before.takes?.lanes[0]?.takes).toHaveLength(2);
        await vi.waitFor(() => expect(recordingLifecycle.settledCommitCount).toBe(settledBefore + 1));
        await settle();
        expectSuccessorUnchanged(before);
        expect(state().cacheCalls).toBe(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('not kept'), 'warning');
    });

    it.each(['completed', 'failed'] as const)('preserves the successor when a stale callback is %s', async (kind) => {
        await startGesture();
        replaceRoot();
        const before = state();
        mocks.releaseTerminal(kind === 'completed' ? { kind, buffer: { duration: 2 } } : { kind });
        await settle();
        expectSuccessorUnchanged(before);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('not kept'),
            kind === 'failed' ? 'error' : 'warning'
        );
        expect(mocks.notifyUser.mock.calls.every(([message]) => !message.includes('discarded'))).toBe(true);
    });

    it('discards only the owning provisional recording after a same-root capture failure', async () => {
        await startGesture();
        mocks.releaseTerminal({ kind: 'failed' });
        await settle();
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expect(committedCount()).toBe(0);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('partial take was discarded'), 'error');
    });
});
