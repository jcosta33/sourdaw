import { clone as cloneAutomergeDoc } from '@automerge/automerge';
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
import * as arrangementUseCases from '#/modules/Arrangement/useCases';
import { stopRecording } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import { undoTreeStore } from '#/modules/Command/stores/undoTree';
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
import { startPlayheadScheduler } from '../../playheadScheduler/startPlayheadScheduler';
import { disposePlayheadScheduler } from '../../playheadScheduler/disposePlayheadScheduler';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';

const TRACK_ID = 'track-recording';
const SESSION_KEY = 'sourdaw-undo-session';
type RecordingTerminal = (result: { kind: 'completed'; buffer: { duration: number } } | { kind: 'failed' }) => void;
const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    let terminals: RecordingTerminal[] = [];
    return {
        audioClock,
        getAudioContext: vi.fn(() => audioClock),
        getCompensationDelay: vi.fn(() => 0),
        cacheAudioBuffer: vi.fn(),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        startAudioRecording: vi.fn<(trackId: string, callback: RecordingTerminal) => Promise<boolean>>(
            (_trackId, callback) => {
                terminals.push(callback);
                return Promise.resolve(true);
            }
        ),
        stopAudioRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        resetTerminals(): void {
            terminals = [];
        },
        releaseTerminal(result: Parameters<RecordingTerminal>[0]): void {
            const callback = terminals.shift();
            if (!callback) {
                throw new Error('No actual production callback was registered');
            }
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
    readNativeEnginePlayheadSeconds: () => null,
    audioEngine: { setTransportInfo: vi.fn() },
    refreshSidechainAlignment: vi.fn(),
    scheduleAdjustmentLayers: vi.fn(),
    stopAllScheduled: vi.fn(),
}));
vi.mock('../../scheduling/scheduleAudioClips', () => ({ scheduleAudioClips: vi.fn() }));
vi.mock('../../scheduling/scheduleMidiNotes', () => ({ scheduleMidiNotes: vi.fn(async () => undefined) }));
vi.mock('../../scheduling/scheduleMetronome', () => ({ scheduleMetronome: vi.fn() }));
vi.mock('../../scheduling/applyAutomation/applyAutomation', () => ({
    applyAutomation: vi.fn(() => new Set<string>()),
}));
vi.mock('../../scheduling/applyAutomation/applyVcaGains', () => ({ applyVcaGains: vi.fn() }));
vi.mock('#/modules/Automation/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Automation/useCases')>()),
    startAutomationRecording: vi.fn(),
    applyModulation: vi.fn(),
    applyModulationToEngine: vi.fn(),
}));
vi.mock('../../evaluateFollowActions', () => ({
    evaluateFollowActions: () => ({ jumpToPosition: null, shouldStop: false }),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

// The real queue cases keep commitRecording, executeAppAction, the repository,
// storage runtime, root witness and handlers real. Only the explicit rejection
// cases below replace a commit to isolate its asynchronous catch cleanup.
function recordingTrack(kind: 'audio' | 'midi', id = TRACK_ID): Track {
    return {
        id,
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
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function jsonCopy<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}
function state() {
    return jsonCopy({
        identity: captureProjectRootIdentity(),
        root: getCrdtDoc(DOC_PREFIX_ROOT),
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
async function startGesture(trackIds = [TRACK_ID]) {
    trackStore.set({
        tracks: trackIds.map((id) => recordingTrack('audio', id)),
        selectedTrackId: TRACK_ID,
        ghostClips: [],
    });
    takeLaneStore.set({ lanes: [] });
    transportStore.set({
        ...defaultTransportState,
        tempo: 120,
        isPlaying: true,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: true,
        punchInBeat: 4,
        punchOutBeat: 8,
        playheadPosition: 4,
    });
    tempoMapStore.set({ changes: [] });
    flushAutomergeStorageWrites();
    await openPunch(trackIds.length, trackIds.length);
}
async function openPunch(expectedClips: number, expectedCaptures: number) {
    startPlayheadScheduler();
    const worker = schedulerSession.worker;
    if (!worker) {
        throw new Error('Expected actual scheduler worker registration');
    }
    mocks.audioClock.currentTime = 0.07;
    const received = performance.timeOrigin + performance.now();
    worker.onmessage?.(
        new MessageEvent('message', {
            data: {
                type: 'tick',
                generation: schedulerSession.generation,
                sequence: 1,
                scheduledAtMs: received - 2,
                sentAtMs: received - 1,
            },
        })
    );
    await vi.waitFor(() => {
        expect(trackStore.value?.tracks.flatMap((track) => track.clips)).toHaveLength(expectedClips);
        expect(mocks.startAudioRecording).toHaveBeenCalledTimes(expectedCaptures);
        expect(schedulerSession.tickInFlight).toBe(false);
    });
    // The actual audio Stop finalizes the scheduler-created clip and takes;
    // the recorder callback remains captive for the real queue experiment.
    await stopRecording(6);
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
        // Finalization happened on the outgoing root. Flush it before installing
        // the clone so stale adapter writes cannot create the counterexample.
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

describe('scheduler terminal through the real snapshot queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resetTerminals();
        disposePlayheadScheduler();
        vi.stubGlobal(
            'Worker',
            class {
                onmessage: ((event: MessageEvent) => void) | null = null;
                postMessage = vi.fn();
                terminate = vi.fn();
                addEventListener = vi.fn();
                removeEventListener = vi.fn();
            }
        );
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
        disposePlayheadScheduler();
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
    it('positive control: scheduler callback genuinely waits and then commits once', async () => {
        const { beforeRelease, after } = await heldCapture(false);
        expect(beforeRelease.history?.past).toEqual([]);
        expect(after.history?.past).toHaveLength(1);
        expect(after.durableHistory?.entries).toHaveLength(1);
        expect(after.tracks?.tracks[0]?.clips[0]).toMatchObject({
            startBeat: 4,
            endBeat: 6,
            audioBufferId: expect.stringMatching(/^rec-/),
        });
        expect(after.warnings).toEqual([]);
    });
    it('scheduler callback must preserve the successor after actually waiting', async () => {
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
    it.each(['completed', 'failed'] as const)(
        'preserves the same-id successor before a stale %s callback',
        async (kind) => {
            await startGesture();
            replaceRoot();
            const before = state();
            mocks.releaseTerminal(kind === 'completed' ? { kind, buffer: { duration: 2 } } : { kind });
            await settle();
            expectSuccessorUnchanged(before);
            expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('not kept'), 'warning');
            expect(mocks.notifyUser.mock.calls.every(([message]) => !message.includes('discarded'))).toBe(true);
        }
    );

    it('cleans its own provisional clip and takes after a same-root capture failure', async () => {
        await startGesture();
        mocks.releaseTerminal({ kind: 'failed' });
        await settle();
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expect(committedCount()).toBe(0);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Punch-in recording failed — the partial take was discarded.',
            'error'
        );
    });

    it.each([false, true])('commit rejection cleans only an owning root (replaced: %s)', async (replace) => {
        await startGesture();
        const entered = deferred();
        let rejectCommit!: (error: Error) => void;
        vi.spyOn(arrangementUseCases, 'commitRecording').mockImplementationOnce(() => {
            entered.resolve();
            return new Promise<void>((_resolve, reject) => {
                rejectCommit = reject;
            });
        });
        const settledBefore = recordingLifecycle.settledCommitCount;
        mocks.releaseTerminal({ kind: 'completed', buffer: { duration: 2 } });
        await entered.promise;
        if (replace) {
            replaceRoot();
        }
        const before = state();
        rejectCommit(new Error('Controlled recording commit rejection'));
        await vi.waitFor(() => expect(recordingLifecycle.settledCommitCount).toBe(settledBefore + 1));
        await settle();
        if (replace) {
            expectSuccessorUnchanged(before);
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('not kept'), 'warning');
            expect(mocks.notifyUser.mock.calls.every(([message]) => !message.includes('discarded'))).toBe(true);
        } else {
            expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
            expect(takeLaneStore.value?.lanes).toEqual([]);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                'Punch-in recording failed — the take was discarded. Try recording again.',
                'error'
            );
        }
        expect(committedCount()).toBe(0);
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledTimes(1);
    });

    it('keeps each armed input capture on the opening root and commits each once', async () => {
        await startGesture([TRACK_ID, 'track-second-input']);
        const clipIds = trackStore.value?.tracks.flatMap((track) => track.clips.map((clip) => clip.id));
        mocks.releaseTerminal({ kind: 'completed', buffer: { duration: 2 } });
        mocks.releaseTerminal({ kind: 'completed', buffer: { duration: 2 } });
        await vi.waitFor(() => expect(committedCount()).toBe(2));
        await settle();
        const clips = trackStore.value?.tracks.flatMap((track) => track.clips) ?? [];
        expect(clips.map((clip) => clip.id)).toEqual(clipIds);
        expect(new Set(clips.map((clip) => clip.audioBufferId)).size).toBe(2);
        expect(
            clips.every((clip) => clip.audioBufferId?.startsWith('rec-') && clip.startBeat === 4 && clip.endBeat === 6)
        ).toBe(true);
        expect(actionHistoryStore.value?.entries).toHaveLength(2);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('captures a fresh root for a later punch without giving its predecessor that authority', async () => {
        await startGesture();
        replaceRoot();
        disposePlayheadScheduler();
        transportStore.set({ ...transportStore.value!, isPlaying: true, isRecording: false, playheadPosition: 4 });
        await openPunch(2, 2);
        const beforeOldTerminal = state();
        const clips = beforeOldTerminal.tracks?.tracks[0]?.clips;
        expect(clips).toHaveLength(2);
        const oldClipId = clips?.[0]?.id;
        const newClipId = clips?.[1]?.id;
        expect(oldClipId).not.toBe(newClipId);
        mocks.releaseTerminal({ kind: 'completed', buffer: { duration: 2 } });
        await settle();
        expectSuccessorUnchanged(beforeOldTerminal);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('not kept'), 'warning');
        mocks.releaseTerminal({ kind: 'completed', buffer: { duration: 2 } });
        await vi.waitFor(() => expect(committedCount()).toBe(1));
        await settle();
        const afterClips = trackStore.value?.tracks[0]?.clips ?? [];
        expect(afterClips.find((clip) => clip.id === oldClipId)?.audioBufferId).toBeUndefined();
        expect(afterClips.find((clip) => clip.id === newClipId)?.audioBufferId).toMatch(/^rec-/);
        expect(mocks.cacheAudioBuffer).toHaveBeenCalledTimes(1);
        expect(actionHistoryStore.value?.entries).toHaveLength(1);
    });
});
