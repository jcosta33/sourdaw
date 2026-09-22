import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, startRecording } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { stopActiveRecording } from '../stopActiveRecording';
import { toggleRecording } from '../toggleRecording';

const TRACK_ID = 'track-recording';

type RecordingTerminal = (result: { kind: 'completed'; buffer: { duration: number } }) => void;

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
        // The real flush settles the capture and invokes its terminal; this mock
        // does the same, so the tracked commit is registered exactly where it is
        // in production.
        stopAudioRecording: vi.fn<() => Promise<void>>(() => {
            const terminal = capturedAudioTerminal;
            capturedAudioTerminal = null;
            terminal?.({ kind: 'completed', buffer: { duration: 2 } });
            return Promise.resolve();
        }),
    };
});

// The Arrangement handler graph imports this barrel too, so the real module is
// spread and only the recording collaborators are replaced.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    getAudioContext: mocks.getAudioContext,
    getCompensationDelay: mocks.getCompensationDelay,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
}));
vi.mock('../startPlayback', () => ({ startPlayback: mocks.startPlayback }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

/**
 * Holds the next `commitRecording` after its transaction has landed, so a test
 * can prove the stop path waits for the promise it owns rather than resolving
 * when an incidental microtask drain happens to have covered the commit. The
 * gate sits on the owning command entry both recording arms dispatch through,
 * so it needs no deep mock of the Arrangement recording module.
 */
const commitGate = vi.hoisted(() => ({
    pending: null as Promise<void> | null,
    release: null as (() => void) | null,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeUserAppAction: async (...args: Parameters<typeof actual.executeUserAppAction>) => {
            await actual.executeUserAppAction(...args);
            if (args[0].type === 'commitRecording' && commitGate.pending) {
                await commitGate.pending;
            }
        },
    };
});

function gateNextCommit(): () => void {
    let release!: () => void;
    commitGate.pending = new Promise<void>((resolve) => {
        release = () => {
            commitGate.pending = null;
            resolve();
        };
    });
    return release;
}

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
        name: kind === 'audio' ? 'Audio' : 'MIDI',
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

function clipIds(): string[] {
    return (trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? []).map((clip) => clip.id);
}

function takeRefs(): { id: string; clipId: string }[] {
    return (takeLaneStore.value?.lanes ?? []).flatMap((lane) =>
        lane.takes.map((take) => ({ id: take.id, clipId: take.clipId }))
    );
}

function laneIds(): string[] {
    return (takeLaneStore.value?.lanes ?? []).map((lane) => lane.id);
}

function findClip(clipId: string): Clip | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

function committedEntryCount(): number {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    ).length;
}

/** Start a real audio recording through the Record toggle and wait until its
 *  clip exists, so Stop has a capture to finalize. */
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

    toggleRecording();
    await vi.waitFor(() => {
        expect(clipIds()).toHaveLength(1);
    });
    flushAutomergeStorageWrites();
}

/**
 * Issue #4439: the user-facing Stop must not resolve before the commits this
 * gesture started have landed. A caller that awaits Stop and then presses Undo
 * acts on whatever heads the history, so a commit left in flight would let that
 * undo consume the previous entry instead of this recording's result. A commit
 * that fails must retire the provisional recording rather than leave visible
 * material no entry owns.
 */
describe('stopActiveRecording commit ordering (issue #4439)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('stop active recording commit ordering');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [recordingTrack('midi')], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, isPlaying: false, isRecording: true, playheadPosition: 8 });
        mocks.startPlayback.mockClear();
        mocks.notifyUser.mockClear();
        mocks.audioClock.currentTime = 0;
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('records the MIDI gesture entry before Stop resolves, so one undo removes the recorded result', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const recordedTakeId = takeRefs()[0]?.id;
        expect(recordedTakeId).toBeTruthy();
        expect(committedEntryCount()).toBe(0);

        // The user's Stop — not `stopRecording` directly.
        await stopActiveRecording();

        // No flush, no wait: awaiting Stop alone must guarantee the entry.
        expect(committedEntryCount()).toBe(1);
        const entry = (undoHistoryStore.value?.past ?? [])[0];
        if (entry?.kind !== 'action') {
            throw new Error('expected the recording commit entry on the history when Stop resolves');
        }
        expect(entry.action.type).toBe('commitRecording');

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([provisional.id]);
        expect(takeRefs()).toEqual([{ id: recordedTakeId, clipId: provisional.id }]);
    });

    it('records the audio gesture entry before Stop resolves, so one undo removes the recorded result', async () => {
        await startAudioRecordingGesture();
        const provisionalId = clipIds()[0];
        if (!provisionalId) {
            throw new Error('expected a provisional recording clip');
        }
        const recordedTakeId = takeRefs()[0]?.id;
        expect(recordedTakeId).toBeTruthy();
        expect(committedEntryCount()).toBe(0);

        // The user's Stop. The audio terminal runs inside the flush it awaits.
        await stopActiveRecording();

        expect(committedEntryCount()).toBe(1);
        const entry = (undoHistoryStore.value?.past ?? [])[0];
        if (entry?.kind !== 'action') {
            throw new Error('expected the recording commit entry on the history when Stop resolves');
        }
        expect(entry.action.type).toBe('commitRecording');

        // The forward write itself: the live clip carries the capture's media
        // and placement, not the provisional state `startRecording` left.
        const committedClip = findClip(provisionalId);
        expect(committedClip?.audioBufferId).toBeTruthy();
        expect(committedClip?.endBeat).toBeGreaterThan(4);

        await undo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);

        await redo();
        flushAutomergeStorageWrites();
        expect(clipIds()).toEqual([provisionalId]);
        expect(takeRefs()).toEqual([{ id: recordedTakeId, clipId: provisionalId }]);
    });

    it('does not resolve Stop until the MIDI commit it triggered has landed', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();

        // Hold the commit after its transaction: only an awaited promise can keep
        // Stop pending here.
        const release = gateNextCommit();
        let settled = false;
        const stopping = stopActiveRecording().then(() => {
            settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);
        release();
        await stopping;
        expect(committedEntryCount()).toBe(1);
    });

    it('does not resolve Stop until the audio commit it owns has landed', async () => {
        await startAudioRecordingGesture();
        expect(clipIds()).toHaveLength(1);

        // The audio terminal registers its commit on the recording lifecycle;
        // untracking it would let Stop resolve while the commit is still held.
        const release = gateNextCommit();
        let settled = false;
        const stopping = stopActiveRecording().then(() => {
            settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);
        release();
        await stopping;
        expect(committedEntryCount()).toBe(1);
    });

    it('retires the provisional MIDI recording and tells the user when its commit fails', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        // Force the commit to reject: with no registered handler,
        // `executeUserAppAction` refuses the action outright.
        clearHandlerRegistry();

        await stopActiveRecording();

        expect(committedEntryCount()).toBe(0);
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording failed — the take was discarded. Try recording again.',
            'error'
        );
    });

    it('retires the provisional audio recording and tells the user when its commit fails', async () => {
        await startAudioRecordingGesture();
        expect(clipIds()).toHaveLength(1);
        clearHandlerRegistry();

        await stopActiveRecording();

        expect(committedEntryCount()).toBe(0);
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording failed — the take was discarded. Try recording again.',
            'error'
        );
    });
});
