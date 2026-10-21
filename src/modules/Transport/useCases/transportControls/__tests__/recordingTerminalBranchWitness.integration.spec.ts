import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { sanitizeTrackSnapshot } from '#/modules/Arrangement/stores/trackStore';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { branchStore } from '#/modules/CrdtDocument/stores';
import {
    DOC_PREFIX_ROOT,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { forkProjectBranch } from '#/modules/CrdtDocument/useCases/crdtBranching/forkProjectBranch';
import { switchBranch } from '#/modules/CrdtDocument/useCases/crdtBranching/switchBranch';
import { transportStore } from '#/modules/Transport/stores';

import { toggleRecording } from '../toggleRecording';

const TRACK_ID = 'track-recording';

type RecordingTerminal = (result: { kind: 'completed'; buffer: { duration: number } } | { kind: 'failed' }) => void;

const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    let capturedAudioTerminal: RecordingTerminal | null = null;
    return {
        audioClock,
        getAudioContext: vi.fn(() => audioClock),
        getCompensationDelay: vi.fn(() => 0),
        cacheAudioBuffer: vi.fn(),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        startPlayback: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        startAudioRecording: vi.fn<(trackId: string, terminal: RecordingTerminal) => Promise<boolean>>(
            (_trackId, terminal) => {
                capturedAudioTerminal = terminal;
                return Promise.resolve(true);
            }
        ),
        // The real Stop awaits a recorder flush that settles the capture and
        // invokes its terminal. This mock keeps the terminal captive instead, so
        // the test can move the project to another branch while the outgoing
        // flush is pending — the exact window of #5289 — and release it after.
        stopAudioRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        releaseHeldTerminal: (result: Parameters<RecordingTerminal>[0]): void => {
            const terminal = capturedAudioTerminal;
            capturedAudioTerminal = null;
            terminal?.(result);
        },
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    getAudioContext: mocks.getAudioContext,
    getCompensationDelay: mocks.getCompensationDelay,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
}));
// A staged optimistic take-lane write crossing a root replacement reconciles
// against the replacement in the matching flush and aborts the branch switch,
// which is orthogonal to the root-identity ownership this spec pins. Only that
// matching flush is a no-op: the plain flush stays real so afterEach empties
// the storage this spec wrote, and the document replacement, branch records,
// and the recording route all stay real.
vi.mock('#/infra/store/storage/createAutomergeStorage', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/store/storage/createAutomergeStorage')>()),
    flushMatchingAutomergeStorageWrites: vi.fn(() => Promise.resolve()),
}));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/modules/CrdtDocument/useCases/compactProject', () => ({ compactProject: vi.fn(() => Promise.resolve()) }));
vi.mock('#/modules/CrdtDocument/useCases/runCrdtPersistenceOperation', () => ({
    runCrdtPersistenceOperation: vi.fn(() => Promise.resolve()),
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

/** Field-identical replica of Arrangement's TrackDummy fixture, as other
 *  modules' specs keep their own copy rather than deep-importing a foreign
 *  `__tests__` helper. */
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

function storeClipIds(): string[] {
    return (trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? []).map((clip) => clip.id);
}

/** Clip ids on the installed root document, the durable truth a cross-root write lands in. */
function documentClipIds(): string[] {
    const document = getCrdtDoc(DOC_PREFIX_ROOT);
    if (!document) {
        throw new Error('expected the root document to be installed');
    }
    const tracks = sanitizeTrackSnapshot(
        (document as { tracks?: Parameters<typeof sanitizeTrackSnapshot>[0] }).tracks
    ).tracks;
    return tracks.flatMap((track) => (track.id === TRACK_ID ? (track.clips ?? []).map((clip) => clip.id) : []));
}

function committedEntryCount(): number {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    ).length;
}

/** Arm an audio track and open a real recording gesture, so a provisional clip is staged. */
async function startAudioRecordingGesture(): Promise<void> {
    trackStore.set({ tracks: [recordingTrack('audio')], selectedTrackId: TRACK_ID, ghostClips: [] });
    takeLaneStore.set({ lanes: [] });
    transportStore.set({
        ...transportStore.value!,
        isPlaying: false,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: false,
        playheadPosition: 4,
    });
    flushAutomergeStorageWrites();
    toggleRecording();
    await vi.waitFor(() => {
        expect(storeClipIds()).toHaveLength(1);
    });
    flushAutomergeStorageWrites();
}

describe('recording terminal publishes only under its captured root (issue #5289)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recording terminal branch witness');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        // The real branch-state authority sequences every durable write on a
        // Web Lock, and jsdom ships no Web Locks API.
        vi.stubGlobal('navigator', { ...navigator, locks: createControlledLockManager().locks });
        const document = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!document) {
            throw new Error('expected the root document to exist after the storage runtime registered');
        }
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
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        trackStore.set({ tracks: [recordingTrack('midi')], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, isPlaying: false, isRecording: false, playheadPosition: 8 });
        mocks.notifyUser.mockClear();
        mocks.cacheAudioBuffer.mockClear();
        mocks.audioClock.currentTime = 0;
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        branchStore.set(null);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('refuses the outgoing terminal after a branch switch, leaving the successor untouched', async () => {
        // The successor is forked before the take opens, so its snapshot holds
        // the track and no recorded clips — the branch that must stay clean.
        const featureBranchId = await forkProjectBranch('feature');
        await switchBranch('main');
        await startAudioRecordingGesture();

        // Stop's flush is held captive; the project moves to the successor
        // while the outgoing terminal is still pending.
        await switchBranch(featureBranchId);
        // The successor forked before the take opened, so its snapshot holds no
        // recorded clips — the branch that must stay clean through the release.
        const successorClipIdsBeforeRelease = documentClipIds();
        expect(successorClipIdsBeforeRelease).toEqual([]);

        mocks.releaseHeldTerminal({ kind: 'completed', buffer: { duration: 2 } });
        await vi.waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalled();
        });

        expect(documentClipIds()).toEqual(successorClipIdsBeforeRelease);
        expect(committedEntryCount()).toBe(0);
        expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
    });

    it('keeps a successor copy of the provisional clip through stale failure cleanup', async () => {
        // The successor is forked after the take opened, and forking installs
        // the successor in the root slot, so its snapshot carries the
        // provisional clip: the old owner's failure cleanup must not delete it
        // out of the successor document.
        await startAudioRecordingGesture();
        await forkProjectBranch('feature');
        const successorClipsWithProvisional = documentClipIds();
        expect(successorClipsWithProvisional).toHaveLength(1);

        mocks.releaseHeldTerminal({ kind: 'failed' });

        expect(documentClipIds()).toEqual(successorClipsWithProvisional);
        expect(committedEntryCount()).toBe(0);
    });

    it('commits the take on the same root the terminal was opened on', async () => {
        await startAudioRecordingGesture();
        const provisionalId = storeClipIds()[0];
        if (!provisionalId) {
            throw new Error('expected a provisional recording clip');
        }

        mocks.releaseHeldTerminal({ kind: 'completed', buffer: { duration: 2 } });
        await vi.waitFor(() => {
            expect(committedEntryCount()).toBe(1);
        });

        expect(mocks.cacheAudioBuffer).toHaveBeenCalled();
        expect(storeClipIds()).toEqual([provisionalId]);
    });
});
