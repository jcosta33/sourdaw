import { toJS } from '@automerge/automerge';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { MockAudioBuffer } from '#/helpers/__tests__/audioContext.mock';
import { withProjectAudioStorageLock } from '#/infra/storage/withProjectAudioStorageLock';
import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { activeRecordingRef, takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import {
    configureDurableAudioBufferOwnership,
    getCachedAudioBuffer,
    releasePreviewAudioBuffer,
} from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, undoHistoryStore, undoTreeStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { defaultTransportState, playheadPositionRef, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { isTransportIdle } from '#/modules/Transport/useCases';

import { DOC_PREFIX_ROOT } from '../../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../../repositories/automergeRepository';
import { branchStateEnvelopeStorage } from '../../../repositories/branchStateEnvelopeStorage';
import { actionHistoryStore } from '../../../stores/actionHistoryStore';
import { branchStore } from '../../../stores/branchStore';
import { captureProjectRootIdentity } from '../../captureProjectRootIdentity';
import { clearActionHistory } from '../../clearActionHistory';
import { initBranchState } from '../../initBranchState';
import { markActionHistoryEntryReverted } from '../../markActionHistoryEntryReverted';
import { setupProjectionBridge } from '../../projection/setupProjectionBridge';
import { recordActionHistoryEntry } from '../../recordActionHistoryEntry';
import { registerCrdtStorageRuntime } from '../../registerCrdtStorageRuntime';
import { resetCrdtProjectAuthority } from '../../resetCrdtProjectAuthority';
import { whenBranchStateSettled } from '../../whenBranchStateSettled';
import { forkProjectBranch } from '../forkProjectBranch';
import { switchBranch } from '../switchBranch';

const TRACK_ID = 'recording-track';
const SESSION_KEY = 'sourdaw-undo-session';
const database = new IDBFactory();
type RecordingTerminal = Parameters<typeof import('#/modules/AudioEngine/useCases').startAudioRecording>[1];
type RecordingResult = Parameters<RecordingTerminal>[0];

const mocks = vi.hoisted(() => {
    let terminal: RecordingTerminal | null = null;
    let pendingTerminal: RecordingTerminal | null = null;
    let flush: PromiseWithResolvers<void> | null = null;
    let firstStop = Promise.withResolvers<void>();
    let secondStop = Promise.withResolvers<void>();
    const clock = { currentTime: 0, sampleRate: 48_000, baseLatency: 0, outputLatency: 0 };
    return {
        clock,
        compactProject: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        startAudioRecording: vi.fn<(trackId: string, callback: RecordingTerminal) => Promise<boolean>>(
            (_trackId, callback) => {
                terminal = callback;
                firstStop = Promise.withResolvers<void>();
                secondStop = Promise.withResolvers<void>();
                return Promise.resolve(true);
            }
        ),
        stopAudioRecording: vi.fn<() => Promise<void>>(() => {
            if (terminal) {
                pendingTerminal = terminal;
                terminal = null;
                flush = Promise.withResolvers<void>();
                firstStop.resolve();
                return flush.promise;
            }
            if (pendingTerminal) {
                // A later Stop has no new capture; Transport must still await
                // the earlier closing Stop, whose terminal has not run yet.
                secondStop.resolve();
            }
            return Promise.resolve();
        }),
        firstStopEntered: () => firstStop.promise,
        secondStopEntered: () => secondStop.promise,
        isHeld: () => flush !== null,
        release(result: RecordingResult): void {
            const callback = pendingTerminal;
            const held = flush;
            if (!callback || !held) {
                throw new Error('Expected the actual recording callback inside a held Stop');
            }
            pendingTerminal = null;
            flush = null;
            try {
                callback(result);
            } finally {
                held.resolve();
            }
        },
        reset(): void {
            terminal = null;
            pendingTerminal = null;
            flush = null;
            firstStop = Promise.withResolvers<void>();
            secondStop = Promise.withResolvers<void>();
        },
    };
});

vi.mock('../../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: () => mocks.clock,
    getCompensationDelay: () => 0,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
    audioEngine: { setTransportInfo: vi.fn() },
    stopAllScheduled: vi.fn(),
    stopNativeLiveGraphSession: vi.fn(() => Promise.resolve({ outcome: 'declined', reason: 'no session' })),
}));
vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    resetMidiState: vi.fn(),
}));
vi.mock('#/modules/Yeast/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Yeast/useCases')>()),
    yeastPanic: vi.fn(() => Promise.resolve()),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

// Only recorder/clock platform edges and compaction completion are controlled.
// Branch lineage, its durable CAS, projection, commands, cache and history are real.
function recordingTrack(): Track {
    return {
        id: TRACK_ID,
        name: 'Audio',
        kind: 'audio',
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

function root() {
    const doc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
    if (!doc) {
        throw new Error('Expected the real project root');
    }
    return doc;
}

function clips() {
    return trackStore.value?.tracks.find(({ id }) => id === TRACK_ID)?.clips ?? [];
}

function commits() {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    );
}

function documentState(id: string) {
    const doc = automergeRepository.getDoc(id);
    if (!doc) {
        throw new Error(`Expected real branch document ${id}`);
    }
    return { heads: automergeRepository.getHeads(id), content: toJS(doc) };
}

function branchState() {
    return structuredClone({
        identity: captureProjectRootIdentity(),
        root: documentState(DOC_PREFIX_ROOT),
        tracks: trackStore.value,
        takes: takeLaneStore.value,
        actionHistory: actionHistoryStore.value,
        undo: undoHistoryStore.value,
        tree: undoTreeStore.value,
        mirror: sessionStorage.getItem(SESSION_KEY),
        branches: branchStore.value,
        durableBranches: branchStateEnvelopeStorage.read(),
    });
}

async function settleStorage(): Promise<void> {
    flushAutomergeStorageWrites();
    await vi.waitFor(() => {
        expect(countPendingAutomergeStorageWrites()).toBe(0);
        expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
    });
}

function pcm(): AudioBuffer {
    const buffer = MockAudioBuffer.create(2, 96_000, 48_000);
    buffer.getChannelData(0).set([0.25, -0.25]);
    buffer.getChannelData(1).set([-0.5, 0.5]);
    return buffer;
}

function completed(buffer: AudioBuffer): RecordingResult {
    return { kind: 'completed', buffer, sampleZeroContextFrame: 0, sampleRate: buffer.sampleRate };
}

function expectPcm(buffer: AudioBuffer): void {
    const clip = clips()[0];
    if (!clip?.audioBufferId) {
        throw new Error('Expected committed media reference');
    }
    const cached = getCachedAudioBuffer({ bufferId: clip.audioBufferId });
    expect(cached === buffer).toBe(true);
    if (!cached) {
        throw new Error('Expected actual cached recording PCM');
    }
    expect([cached.numberOfChannels, cached.sampleRate, cached.length]).toEqual([2, 48_000, 96_000]);
    expect(Array.from(cached.getChannelData(0).slice(0, 2))).toEqual([0.25, -0.25]);
    expect(Array.from(cached.getChannelData(1).slice(0, 2))).toEqual([-0.5, 0.5]);
}

async function openRecording(): Promise<string> {
    // Record during an existing roll exercises the real manual Record command
    // without introducing scheduler startup into the branch-owner contract.
    transportStore.set({ ...defaultTransportState, tempo: 120, isPlaying: true, playheadPosition: 4 });
    playheadPositionRef.current = 4;
    flushAutomergeStorageWrites();
    await executeAppAction({ type: 'toggleRecording' });
    await vi.waitFor(() => {
        expect(mocks.startAudioRecording).toHaveBeenCalledExactlyOnceWith(TRACK_ID, expect.any(Function), null);
        expect(clips()).toHaveLength(1);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)).toHaveLength(1);
        expect(transportStore.value?.isRecording).toBe(true);
    });
    await settleStorage();
    const clip = clips()[0];
    if (!clip) {
        throw new Error('Expected the provisional recording clip');
    }
    return clip.id;
}

const operations = new Set<Promise<void>>();
function observe(operation: Promise<void>): Promise<void> {
    operations.add(operation);
    // Observe rejection immediately, even while a test is inspecting a held
    // recorder. The original promise is still awaited for its actual result.
    void operation.catch(() => undefined);
    return operation;
}

async function heldStop(): Promise<{ stopping: Promise<void>; identity: string }> {
    const identity = captureProjectRootIdentity();
    const stopping = observe(executeAppAction({ type: 'stopPlayback' }));
    await mocks.firstStopEntered();
    expect(mocks.isHeld()).toBe(true);
    expect(captureProjectRootIdentity()).toBe(identity);
    expect(transportStore.value).toMatchObject({ isPlaying: false, isRecording: false });
    expect(isTransportIdle()).toBe(false);
    expect(commits()).toHaveLength(0);
    return { stopping, identity };
}

describe('recording terminals through actual project branch transitions', () => {
    let unsubscribeProjection: (() => void) | null = null;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.reset();
        operations.clear();
        vi.stubGlobal('indexedDB', database);
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        configureDurableAudioBufferOwnership(() => Promise.resolve([]));
        vi.spyOn(audioBufferCache, 'set');
        configureAutomergeStoragePort(null);
        localStorage.removeItem('sourdaw-branch-state');
        localStorage.removeItem('sourdaw-branches');
        resetCrdtProjectAuthority('recording branch ownership');
        registerCrdtStorageRuntime();
        initBranchState();
        await whenBranchStateSettled();
        clearHandlerRegistry();
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        clearUndoHistory();
        sessionStorage.removeItem(SESSION_KEY);
        actionHistoryStore.set({ entries: [] });
        const tree = undoTreeStore.value;
        if (!tree) {
            throw new Error('Expected the actual Undo tree');
        }
        undoTreeStore.set({ ...tree, enabled: true });
        activeRecordingRef.current = [];
        activeRecordingRef.capturedRootIdentity = null;
        trackStore.set({ tracks: [recordingTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState, tempo: 100 });
        tempoMapStore.set({ changes: [] });
        mocks.clock.currentTime = 0;
        flushAutomergeStorageWrites();
        unsubscribeProjection = setupProjectionBridge();
        await executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });
        await settleStorage();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        expect(actionHistoryStore.value?.entries).toHaveLength(1);
    });

    afterEach(async () => {
        try {
            if (mocks.isHeld()) {
                mocks.release({ kind: 'failed', reason: 'worker-error' });
            }
            await Promise.allSettled(operations);
            const ids = vi.mocked(audioBufferCache.set).mock.calls.map(([id]) => id);
            const receipt = await audioBufferCache.ensureDurable(ids);
            expect(receipt.status).toBe('durable');
            if (receipt.status === 'durable') {
                receipt.release();
            }
            for (const id of ids) {
                releasePreviewAudioBuffer(id);
                expect(getCachedAudioBuffer({ bufferId: id })).toBeNull();
            }
            await withProjectAudioStorageLock(() => Promise.resolve());
        } finally {
            unsubscribeProjection?.();
            unsubscribeProjection = null;
            clearUndoHistory();
            clearHandlerRegistry();
            resetActionReplayAuthority();
            activeRecordingRef.current = [];
            activeRecordingRef.capturedRootIdentity = null;
            flushAutomergeStorageWrites();
            configureAutomergeStoragePort(null);
            configureDurableAudioBufferOwnership(null);
            automergeRepository.reset();
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
        }
    });

    it('same owner commits real stereo media once and preserves the prior entry through Undo and Redo', async () => {
        const prior = structuredClone(undoHistoryStore.value?.past);
        const clipId = await openRecording();
        const { stopping, identity } = await heldStop();
        const buffer = pcm();
        mocks.release(completed(buffer));
        await stopping;
        await settleStorage();

        expect(captureProjectRootIdentity()).toBe(identity);
        expect(isTransportIdle()).toBe(true);
        expect(commits()).toHaveLength(1);
        expect(actionHistoryStore.value?.entries.map((entry) => entry.actionKind)).toEqual([
            'setTempo',
            'commitRecording',
        ]);
        expect(undoHistoryStore.value?.past.slice(0, 1)).toEqual(prior);
        expect(clips()[0]).toMatchObject({ id: clipId, startBeat: 4, endBeat: 8 });
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes).map((take) => take.clipId)).toEqual([clipId]);
        expectPcm(buffer);
        const recorded = structuredClone({ clips: clips(), takes: takeLaneStore.value });
        const entryId = commits()[0]?.id;
        const tree = undoTreeStore.value?.tree;
        expect(tree?.nodes[tree.currentNodeId!]?.entry.id).toBe(entryId);
        const raw = toJS(root());
        const projectedTracks = trackStore.value?.tracks;
        expect(projectedTracks).toHaveLength(1);
        const durableTracks = projectedTracks?.map(({ frozenBufferId, showVariationLanes, ...track }, index) => {
            expect(frozenBufferId).toBeUndefined();
            expect(showVariationLanes).toBeUndefined();
            expect(raw).not.toHaveProperty(`tracks.tracks.${index}.frozenBufferId`);
            expect(raw).not.toHaveProperty(`tracks.tracks.${index}.showVariationLanes`);
            return track;
        });
        expect(raw).toHaveProperty('tracks.tracks', durableTracks);

        await undo();
        await settleStorage();
        expect(clips()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expect(undoHistoryStore.value?.past).toEqual(prior);
        expect(undoHistoryStore.value?.future).toHaveLength(1);
        await redo();
        await settleStorage();
        expect({ clips: clips(), takes: takeLaneStore.value }).toEqual(recorded);
        expect(commits().map((entry) => entry.id)).toEqual([entryId]);
        expect(undoHistoryStore.value?.past.slice(0, 1)).toEqual(prior);
        expectPcm(buffer);
        expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1);
        expect(vi.mocked(audioBufferCache.set)).toHaveBeenCalledTimes(1);
    });

    it('same-owner failure discards its own provisional clip and takes without recording history', async () => {
        const prior = structuredClone(undoHistoryStore.value);
        await openRecording();
        const { stopping } = await heldStop();
        mocks.release({ kind: 'failed', reason: 'worker-error' });
        await stopping;
        await settleStorage();
        expect(clips()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expect(undoHistoryStore.value).toEqual(prior);
        expect(commits()).toHaveLength(0);
        expect(audioBufferCache.set).not.toHaveBeenCalled();
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording failed — the partial take was discarded. Check your audio input and try again.',
            'error'
        );
    });

    it('real switch waits for the held Stop, snapshots the completed outgoing take, and clears incoming Undo', async () => {
        const outgoingId = branchStore.value!.activeBranchId;
        const peerId = await forkProjectBranch('Empty peer');
        const peerDocId = branchStore.value!.branches.find(({ branchId }) => branchId === peerId)!.rootDocId;
        const peer = documentState(peerDocId);
        await switchBranch(outgoingId);
        await openRecording();
        const { stopping, identity } = await heldStop();
        const originalReplace = automergeRepository.replaceDoc.bind(automergeRepository);
        const replacements: ReturnType<typeof branchState>[] = [];
        vi.spyOn(automergeRepository, 'replaceDoc').mockImplementation((id, doc, transaction) => {
            if (id === DOC_PREFIX_ROOT) {
                replacements.push(branchState());
            }
            originalReplace(id, doc, transaction);
        });
        const switching = observe(switchBranch(peerId));
        await mocks.secondStopEntered();
        expect(mocks.isHeld()).toBe(true);
        expect(replacements).toEqual([]);
        expect(captureProjectRootIdentity()).toBe(identity);
        expect(branchStore.value?.activeBranchId).toBe(outgoingId);

        const buffer = pcm();
        mocks.release(completed(buffer));
        await Promise.all([stopping, switching]);
        await settleStorage();
        expect(replacements).toHaveLength(1);
        const outgoing = replacements[0]!;
        const outgoingClip = outgoing.tracks?.tracks[0]?.clips[0];
        expect(outgoingClip).toMatchObject({ startBeat: 4, endBeat: 8 });
        expect(outgoingClip?.audioBufferId).toBeTruthy();
        expect(
            outgoing.undo?.past.filter((entry) => entry.kind === 'action' && entry.action.type === 'commitRecording')
        ).toHaveLength(1);
        const backing = branchStore.value!.branches.find(({ branchId }) => branchId === outgoingId)!.rootDocId;
        expect(documentState(backing).content).toEqual(outgoing.root.content);
        expect(documentState(DOC_PREFIX_ROOT).content).toEqual(peer.content);
        expect(clips()).toEqual([]);
        expect(takeLaneStore.value?.lanes).toEqual([]);
        expect(branchStore.value?.activeBranchId).toBe(peerId);
        expect(branchStateEnvelopeStorage.read()?.current).toEqual(branchStore.value);
        expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
        expect(undoTreeStore.value?.tree.currentNodeId).toBeNull();
        expect(JSON.parse(sessionStorage.getItem(SESSION_KEY)!)).toMatchObject({ past: [], future: [] });
        expect(actionHistoryStore.value?.entries.some((entry) => entry.actionKind === 'commitRecording')).toBe(false);
        expect(getCachedAudioBuffer({ bufferId: outgoingClip!.audioBufferId! })).toBe(buffer);
        expect(mocks.compactProject).toHaveBeenCalledTimes(3);
    });

    it.each(['completed', 'failed'] as const)(
        'real fork preserves its copied root and history after stale %s',
        async (kind) => {
            await openRecording();
            const { stopping, identity } = await heldStop();
            const forkId = await forkProjectBranch('Fork during flush');
            await settleStorage();
            expect(mocks.isHeld()).toBe(true);
            expect(captureProjectRootIdentity()).not.toBe(identity);
            expect(branchStore.value?.activeBranchId).toBe(forkId);
            expect(branchStateEnvelopeStorage.read()?.current).toEqual(branchStore.value);
            expect(mocks.compactProject).toHaveBeenCalledExactlyOnceWith();
            expect(clips()).toHaveLength(1);
            expect(clips()[0]?.audioBufferId).toBeUndefined();
            const before = branchState();
            const backings = branchStore.value!.branches.map(({ rootDocId }) => ({
                id: rootDocId,
                ...documentState(rootDocId),
            }));
            mocks.release(kind === 'completed' ? completed(pcm()) : { kind: 'failed', reason: 'worker-error' });
            await stopping;
            await settleStorage();
            expect(branchState()).toEqual(before);
            expect(
                branchStore.value!.branches.map(({ rootDocId }) => ({ id: rootDocId, ...documentState(rootDocId) }))
            ).toEqual(backings);
            expect(audioBufferCache.set).not.toHaveBeenCalled();
            expect(commits()).toHaveLength(0);
            expect(mocks.startAudioRecording).toHaveBeenCalledTimes(1);
            expect(mocks.notifyUser).toHaveBeenCalledWith(
                kind === 'completed'
                    ? 'Recording stopped — the project switched branches while the take was finishing, so it was not kept.'
                    : 'Recording failed — the partial take was not kept on this branch.',
                kind === 'completed' ? 'warning' : 'error'
            );
        }
    );
});
