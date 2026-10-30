import { clone as cloneAutomergeDoc, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { activeRecordingRef, takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, undoHistoryStore, undoTreeStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
    redo,
} from '#/modules/Command/useCases';
import { actionHistoryStore, branchStore } from '#/modules/CrdtDocument/stores';
import {
    DOC_PREFIX_ROOT,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    replaceCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { disposePlayheadScheduler } from '../../playheadScheduler/disposePlayheadScheduler';
import { schedulerSession } from '../../playheadScheduler/schedulerSession';
import { pausePlayback } from '../../transportControls/pausePlayback';
import { recordingLifecycle } from '../../transportControls/recordingLifecycle';
import { startPlayback } from '../../transportControls/startPlayback';

const TRACK_ID = 'track-recording';
const SESSION_KEY = 'sourdaw-undo-session';
type RecordingTerminal = (result: { kind: 'completed'; buffer: { duration: number } } | { kind: 'failed' }) => void;
const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    let terminals: RecordingTerminal[] = [];
    let pending: Array<{ callback: RecordingTerminal; resolve: () => void }> = [];
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
        stopAudioRecording: vi.fn<() => Promise<void>>(() => {
            const callback = terminals.shift();
            if (!callback) {
                return Promise.resolve();
            }
            return new Promise<void>((resolve) => pending.push({ callback, resolve }));
        }),
        reset(): void {
            terminals = [];
            pending = [];
        },
        pendingCount(): number {
            return pending.length;
        },
        release(): void {
            const capture = pending.shift();
            if (!capture) {
                throw new Error('Expected a held recorder flush');
            }
            capture.callback({ kind: 'completed', buffer: { duration: 2 } });
            capture.resolve();
        },
    };
});
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: mocks.getAudioContext,
    resumeEngine: vi.fn(() => Promise.resolve()),
    nativeLiveGraphSessionOffered: () => false,
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

async function tick(expectedCaptures: number): Promise<void> {
    const worker = schedulerSession.worker;
    if (!worker) {
        throw new Error('Expected a scheduler worker from Play');
    }
    mocks.audioClock.currentTime += 0.07;
    const now = performance.timeOrigin + performance.now();
    worker.onmessage?.(
        new MessageEvent('message', {
            data: {
                type: 'tick',
                generation: schedulerSession.generation,
                sequence: expectedCaptures,
                scheduledAtMs: now - 2,
                sentAtMs: now - 1,
            },
        })
    );
    await vi.waitFor(() => {
        expect(mocks.startAudioRecording).toHaveBeenCalledTimes(expectedCaptures);
        expect(schedulerSession.tickInFlight).toBe(false);
    });
}
function commits(): number {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    ).length;
}
function captured() {
    return structuredClone({ tracks: trackStore.value, takes: takeLaneStore.value });
}
async function openFirst() {
    trackStore.set({ tracks: [recordingTrack('audio')], selectedTrackId: TRACK_ID, ghostClips: [] });
    takeLaneStore.set({ lanes: [] });
    transportStore.set({
        ...defaultTransportState,
        tempo: 120,
        isPlaying: false,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: true,
        punchInBeat: 4,
        punchOutBeat: 8,
        playheadPosition: 4,
    });
    tempoMapStore.set({ changes: [] });
    flushAutomergeStorageWrites();
    await startPlayback();
    await tick(1);
    expect(schedulerSession.punchRecordingActive).toBe(true);
    const old = activeRecordingRef.current[0];
    expect(old).toBeTruthy();
    return old;
}

describe('automatic punch Pause and Play with real recording commits', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.reset();
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
        resetCrdtProjectAuthority('punch pause play');
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
    it.each(['old-first', 'successor-first'] as const)('retains both captures when %s', async (order) => {
        const old = await openFirst();
        const oldGeneration = schedulerSession.generation;
        pausePlayback();
        expect(mocks.pendingCount()).toBe(1);
        await startPlayback();
        const successorGeneration = schedulerSession.generation;
        expect(successorGeneration).toBeGreaterThan(oldGeneration);
        if (order === 'old-first') {
            mocks.release();
            await vi.waitFor(() => expect(commits()).toBe(1));
        }
        await tick(2);
        const successor = activeRecordingRef.current[0];
        expect(successor).toBeTruthy();
        expect(successor).not.toBe(old);
        expect(schedulerSession.punchRecordingActive).toBe(true);
        const beforeOldCompletion = captured();
        if (order === 'successor-first') {
            mocks.release();
            await vi.waitFor(() => expect(commits()).toBe(1));
            expect(activeRecordingRef.current).toEqual([successor]);
            expect(schedulerSession.punchRecordingActive).toBe(true);
            expect(schedulerSession.generation).toBe(successorGeneration);
            expect(captured().tracks?.tracks[0]?.clips.find((clip) => clip.id === successor)).toEqual(
                beforeOldCompletion.tracks?.tracks[0]?.clips.find((clip) => clip.id === successor)
            );
        }
        pausePlayback();
        expect(mocks.pendingCount()).toBe(1);
        mocks.release();
        await vi.waitFor(() => expect(commits()).toBe(2));
        await recordingLifecycle.waitForCommits();
        flushAutomergeStorageWrites();
        const full = captured();
        const clips = full.tracks?.tracks[0]?.clips ?? [];
        expect(clips.map((clip) => clip.id)).toEqual([old, successor]);
        expect(clips.every((clip) => clip.audioBufferId?.startsWith('rec-'))).toBe(true);
        expect(new Set(clips.map((clip) => clip.audioBufferId)).size).toBe(2);
        expect(full.takes?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).toEqual([old, successor]);
        expect(actionHistoryStore.value?.entries).toHaveLength(2);
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('Expected committed project root');
        }
        const raw = toJS(root);
        expect(raw.tracks).toEqual({ tracks: full.tracks?.tracks });
        expect(raw.takeLanes).toEqual(full.takes);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([old]);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).toEqual([old]);
        await undo();
        expect(trackStore.value?.tracks[0]?.clips).toEqual([]);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)).toEqual([]);
        await redo();
        expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual([old]);
        expect(takeLaneStore.value?.lanes.flatMap((lane) => lane.takes.map((take) => take.clipId))).toEqual([old]);
        await redo();
        expect(captured()).toEqual(full);
    });
    it('commits an ordinary pause before resuming without a held predecessor', async () => {
        const old = await openFirst();
        pausePlayback();
        mocks.release();
        await vi.waitFor(() => expect(commits()).toBe(1));
        await vi.waitFor(() => expect(schedulerSession.worker).toBeNull());
        await startPlayback();
        await tick(2);
        expect(activeRecordingRef.current[0]).not.toBe(old);
        pausePlayback();
        mocks.release();
        await vi.waitFor(() => expect(commits()).toBe(2));
    });

    it('refuses an old terminal after root replacement without changing its successor', async () => {
        await openFirst();
        pausePlayback();
        flushAutomergeStorageWrites();
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('Expected outgoing project root');
        }
        replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
        projectCrdtToStores({ resetProjections: true });
        flushAutomergeStorageWrites();
        const successorRoot = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!successorRoot) {
            throw new Error('Expected successor project root');
        }
        const before = structuredClone(toJS(successorRoot));
        const beforeProjection = captured();
        mocks.release();
        await vi.waitFor(() =>
            expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('not kept'), 'warning')
        );
        flushAutomergeStorageWrites();
        const after = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!after) {
            throw new Error('Expected successor project root after terminal');
        }
        expect(toJS(after)).toEqual(before);
        expect(captured()).toEqual(beforeProjection);
        expect(commits()).toBe(0);
    });
});
