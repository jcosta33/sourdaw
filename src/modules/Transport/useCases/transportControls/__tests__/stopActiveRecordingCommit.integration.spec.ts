import { clone as cloneAutomergeDoc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { activeRecordingRef, takeLaneStore, trackStore, type Clip, type Track } from '#/modules/Arrangement/stores';
import {
    admitRecordingMidiNoteOn,
    getArrangementHandlers,
    retireRecordingMidiAdmission,
    stageRecordingTake,
    startRecording,
    takeOwnsRecordingRoot,
} from '#/modules/Arrangement/useCases';
import { audioEngine } from '#/modules/AudioEngine/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    DOC_PREFIX_ROOT,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { createWebMidiNoteKey } from '#/modules/MIDI/models/WebMidiTypes';
import { getTargetTrackId } from '#/modules/MIDI/repositories/webMidi/getTargetTrackId';
import { setMpeEnabledInternal } from '#/modules/MIDI/repositories/webMidi/setMpeEnabledInternal';
import { setTargetTrackId } from '#/modules/MIDI/repositories/webMidi/setTargetTrackId';
import { activeNotes } from '#/modules/MIDI/repositories/webMidi/state';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { triggerLiveNoteOn } from '#/modules/MIDI/useCases/triggerLiveNoteOn';
import { handleWebMidiMessage } from '#/modules/MIDI/useCases/webMidiInput/handleWebMidiMessage';
import { playheadClockRef, playheadWrapCountRef, transportStore } from '#/modules/Transport/stores';

import { countSettledTakes } from '../countSettledTakes';
import { finalizeAutomaticRecording } from '../finalizeAutomaticRecording';
import { isTransportIdle } from '../isTransportIdle';
import { recordingLifecycle } from '../recordingLifecycle';
import { stopActiveRecording } from '../stopActiveRecording';
import { toggleRecording } from '../toggleRecording';

const TRACK_ID = 'track-recording';

type RecordingTerminal = (result: {
    kind: 'completed';
    buffer: { duration: number };
    sampleZeroContextFrame: number;
    sampleRate: number;
}) => void;

const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    let capturedAudioTerminal: RecordingTerminal | null = null;
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
            terminal?.({ kind: 'completed', buffer: { duration: 2 }, sampleZeroContextFrame: 0, sampleRate: 48000 });
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
vi.mock('../startPlayback', () => ({
    startPlayback: async (onRoll?: (contextSeconds: number, beat: number) => void) => {
        await mocks.startPlayback();
        playheadClockRef.beat = transportStore.value!.playheadPosition;
        playheadClockRef.audioTimeSeconds = mocks.audioClock.currentTime;
        onRoll?.(playheadClockRef.audioTimeSeconds, playheadClockRef.beat);
    },
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

/**
 * Holds the next `commitRecording` after its transaction has landed, so a test
 * can prove the stop path waits for the promise it owns rather than resolving
 * when an incidental microtask drain happens to have covered the commit. The
 * gate sits on the owning command entry both recording arms dispatch through,
 * so it needs no deep mock of the Arrangement recording module.
 */
const commitGate = vi.hoisted(() => ({
    beforeClipId: null as string | null,
    beforePending: null as Promise<void> | null,
    pending: null as Promise<void> | null,
    release: null as (() => void) | null,
}));

const liveMidiGate = vi.hoisted(() => ({ pending: null as Promise<void> | null }));
vi.mock('#/modules/MIDI/useCases/webMidiInput/handleWebMidiNoteOn', () => ({
    handleWebMidiNoteOn: () => liveMidiGate.pending ?? Promise.resolve(),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeAppAction: async (...args: Parameters<typeof actual.executeAppAction>) => {
            if (args[0].type === 'commitRecording' && args[0].payload.clip.id === commitGate.beforeClipId) {
                await commitGate.beforePending;
            }
            await actual.executeAppAction(...args);
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

const repairRequired = {
    audioGraphValid: false,
    detectedRevision: 'repair-revision',
    inspectionAvailable: true,
    projectInvariantsValid: false,
    rawProjectRetained: true as const,
    repairCandidates: [],
    status: 'repair-required' as const,
};

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
        midiStore.set(structuredClone(defaultMidiStoreState));
        activeNotes.clear();
        setTargetTrackId(TRACK_ID);
        playheadWrapCountRef.current = 0;
        transportStore.set({ ...transportStore.value!, isPlaying: false, isRecording: true, playheadPosition: 8 });
        mocks.startPlayback.mockClear();
        mocks.notifyUser.mockClear();
        mocks.audioClock.currentTime = 0;
        mocks.getCompensationDelay.mockReturnValue(0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Reflect.deleteProperty(audioEngine.context, 'currentTime');
        commitGate.beforeClipId = null;
        commitGate.beforePending = null;
        liveMidiGate.pending = null;
        agentProjectRepairStateStore.set(null);
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        midiStore.set(structuredClone(defaultMidiStoreState));
        activeNotes.clear();
        setTargetTrackId(null);
        setMpeEnabledInternal(false);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('counts no settled take when the root moves while the commit is parked', async () => {
        // The parked window this change centers on (#5517): the stop passes
        // the ownership pre-check, the dispatch parks, the root moves, and
        // the refused resume must not read as a take this project gained.
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const settledBefore = recordingLifecycle.settledCommitCount;

        const release = gateNextCommit();
        const stopping = stopActiveRecording();
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('expected the root document to be installed');
        }
        replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
        release();
        await stopping;

        expect(recordingLifecycle.settledCommitCount).toBe(settledBefore);
        expect(committedEntryCount()).toBe(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording stopped — the project switched branches while the take was landing, so it was not kept.',
            'warning'
        );
    });

    it('counts the landed sibling when another clip refuses after the root moves', async () => {
        trackStore.set({
            tracks: [recordingTrack('midi'), { ...recordingTrack('midi'), id: `${TRACK_ID}-2` }],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        const clips = startRecording(4);
        expect(clips).toHaveLength(2);
        const second = clips[1];
        if (!second) {
            throw new Error('expected the second recording clip');
        }
        flushAutomergeStorageWrites();
        const settledBefore = countSettledTakes();
        const gate = Promise.withResolvers<void>();
        commitGate.beforeClipId = second.id;
        commitGate.beforePending = gate.promise;

        const stopping = stopActiveRecording();
        try {
            await vi.waitFor(() => expect(committedEntryCount()).toBe(1));
            const root = getCrdtDoc(DOC_PREFIX_ROOT);
            if (!root) {
                throw new Error('expected the root document to be installed');
            }
            replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
        } finally {
            gate.resolve();
            await stopping;
        }

        expect(countSettledTakes()).toBe(settledBefore + 1);
        expect(committedEntryCount()).toBe(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording stopped — the project switched branches while the take was landing, so it was not kept.',
            'warning'
        );
    });

    it('counts no settled take for an automatic punch-out the root guard refuses', async () => {
        // The scheduler route (#5517): a fork mid-take, then the punch-out
        // finaliser runs under the successor root and must count nothing.
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const settledBefore = recordingLifecycle.settledCommitCount;
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('expected the root document to be installed');
        }
        replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });

        // The guard itself, not the outcome filter downstream: a refused
        // punch-out is never handed to the take counter at all (#5517).
        const trackTakeCommit = vi.spyOn(recordingLifecycle, 'trackTakeCommit');
        finalizeAutomaticRecording(8);
        await vi.waitFor(() => {
            expect(mocks.notifyUser).toHaveBeenCalled();
        });

        expect(recordingLifecycle.settledCommitCount).toBe(settledBefore);
        expect(committedEntryCount()).toBe(0);
        expect(trackTakeCommit).not.toHaveBeenCalled();
    });

    it('counts no settled take for an automatic finalize after the refs are cleared', async () => {
        // The double-stop route (#5517): the user Stop already closed the
        // take; the scheduler teardown's later finalize is a no-op and must
        // not count a second take.
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const settledBefore = recordingLifecycle.settledCommitCount;
        await stopActiveRecording();
        expect(recordingLifecycle.settledCommitCount).toBe(settledBefore + 1);

        finalizeAutomaticRecording(8);
        await recordingLifecycle.waitForCommits();

        expect(recordingLifecycle.settledCommitCount).toBe(settledBefore + 1);
    });

    it('counts no settled take for a stop the root guard refuses', async () => {
        // The ownership helper must answer against the real root identity epoch
        // (#5517): a take staged under one root, moved to another, stops
        // through the real user Stop path and closes nothing — no settled-take
        // count, no commit entry, and the branch-move notice instead.
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        expect(takeOwnsRecordingRoot()).toBe(true);
        const settledBefore = recordingLifecycle.settledCommitCount;

        // The identity-moving replacement a branch fork or switch performs,
        // through the barrel's own seam.
        const root = getCrdtDoc(DOC_PREFIX_ROOT);
        if (!root) {
            throw new Error('expected the root document to be installed');
        }
        replaceCrdtDoc({ id: DOC_PREFIX_ROOT, doc: cloneAutomergeDoc(root) });
        expect(takeOwnsRecordingRoot()).toBe(false);

        // The guard itself: a refused user stop is never handed to the take
        // counter (#5517), independent of the outcome filter downstream.
        const trackTakeCommit = vi.spyOn(recordingLifecycle, 'trackTakeCommit');
        await stopActiveRecording();
        expect(trackTakeCommit).not.toHaveBeenCalled();

        expect(recordingLifecycle.settledCommitCount).toBe(settledBefore);
        expect(committedEntryCount()).toBe(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording stopped — the project switched branches while recording, so it was not kept.',
            'warning'
        );

        // A null witness is the legacy in-flight reading and always owns.
        const witness = activeRecordingRef.capturedRootIdentity;
        activeRecordingRef.capturedRootIdentity = null;
        expect(takeOwnsRecordingRoot()).toBe(true);
        activeRecordingRef.capturedRootIdentity = witness;
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

    it('seals a held MIDI note in the one Stop command before its key-up can arrive', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional MIDI clip');
        }
        flushAutomergeStorageWrites();
        // The live handler registers this note before awaiting Yeast. The
        // worker may still be held when the musician presses Stop.
        activeNotes.set(createWebMidiNoteKey(1, 60), {
            startTime: 0.5,
            startBeat: 5,
            channel: 1,
            note: 60,
            velocity: 100,
            trackId: TRACK_ID,
            recordingClipId: provisional.id,
            instrumentTrackId: TRACK_ID,
        });
        mocks.audioClock.currentTime = 1;

        await stopActiveRecording();

        const notes = midiStore.value?.notesByClipId[provisional.id] ?? [];
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ pitch: 60, velocity: 100 });
        expect(committedEntryCount()).toBe(1);
        await undo();
        expect(midiStore.value?.notesByClipId[provisional.id] ?? []).toEqual([]);
        await redo();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);
    });

    it('seals an admitted note still queued behind a held worker in its onset pass', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional MIDI clip');
        }
        flushAutomergeStorageWrites();
        // The physical callback accepted this key before its note handler could
        // run. The playhead has since crossed the loop seam and Stop arrives.
        activeRecordingRef.midiAdmissions.push({
            id: 'admitted-key',
            clipId: provisional.id,
            trackId: TRACK_ID,
            channel: 1,
            note: 62,
            velocity: 111,
            onsetAudioTime: 0.5,
            onsetSourceBeat: 1,
        });
        mocks.audioClock.currentTime = 1;

        await stopActiveRecording();

        const notes = midiStore.value?.notesByClipId[provisional.id] ?? [];
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ pitch: 62, velocity: 111, startBeat: 1 });
        expect(committedEntryCount()).toBe(1);
        await undo();
        expect(midiStore.value?.notesByClipId[provisional.id] ?? []).toEqual([]);
        await redo();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);
    });

    it('admits physical and virtual notes before Stop while live input remains pending', async () => {
        transportStore.set({
            ...transportStore.value!,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
            playheadPosition: 4,
        });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional MIDI clip');
        }
        flushAutomergeStorageWrites();
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        playheadClockRef.beat = 4.5;
        playheadClockRef.audioTimeSeconds = 0.5;
        mocks.audioClock.currentTime = 0.5;
        Object.defineProperty(audioEngine.context, 'currentTime', {
            configurable: true,
            get: () => mocks.audioClock.currentTime,
        });
        expect(audioEngine.context.currentTime).toBe(0.5);
        expect(activeRecordingRef.current).toEqual([provisional.id]);
        expect(getTargetTrackId()).toBe(TRACK_ID);
        expect(takeOwnsRecordingRoot()).toBe(true);
        const probe = admitRecordingMidiNoteOn({
            trackId: TRACK_ID,
            channel: 15,
            note: 1,
            velocity: 1,
            audioTime: 0.5,
            position: { beat: 8, passIndex: 0 },
        });
        expect(probe).not.toBeNull();
        retireRecordingMidiAdmission(probe!.id);
        const worker = Promise.withResolvers<void>();
        liveMidiGate.pending = worker.promise;
        setMpeEnabledInternal(true);

        const physical = handleWebMidiMessage({ data: new Uint8Array([0x91, 62, 111]), timeStamp: undefined });
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'Take 2',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 0,
            recordingPassIndex: 0,
        });
        playheadWrapCountRef.current = 1;
        playheadClockRef.beat = 4.75;
        playheadClockRef.audioTimeSeconds = 3;
        mocks.audioClock.currentTime = 3;
        const slide = handleWebMidiMessage({ data: new Uint8Array([0xb1, 74, 90]), timeStamp: undefined });
        const pressure = handleWebMidiMessage({ data: new Uint8Array([0xd1, 70]), timeStamp: undefined });
        const bend = handleWebMidiMessage({ data: new Uint8Array([0xe1, 0, 96]), timeStamp: undefined });
        const virtual = triggerLiveNoteOn(2, 64, 99);
        stageRecordingTake({
            trackId: TRACK_ID,
            clipId: provisional.id,
            name: 'Take 3',
            startBeat: 4,
            endBeat: 8,
            sourceOffsetBeats: 4,
            recordingPassIndex: 1,
        });
        playheadWrapCountRef.current = 2;
        playheadClockRef.beat = 5;
        playheadClockRef.audioTimeSeconds = 5.5;
        mocks.audioClock.currentTime = 5.5;
        const physicalThird = handleWebMidiMessage({
            data: new Uint8Array([0x93, 67, 88]),
            timeStamp: undefined,
        });
        expect(activeRecordingRef.midiAdmissions.map((admitted) => [admitted.note, admitted.onsetSourceBeat])).toEqual([
            [62, 0.5],
            [64, 4.75],
            [67, 9],
        ]);
        playheadClockRef.beat = 5.5;
        playheadClockRef.audioTimeSeconds = 6;
        mocks.audioClock.currentTime = 6;

        await stopActiveRecording();
        worker.resolve();
        await Promise.all([physical, virtual, physicalThird, slide, pressure, bend]);

        const notes = midiStore.value?.notesByClipId[provisional.id] ?? [];
        expect(notes.map((note) => [note.pitch, note.startBeat, note.duration])).toEqual([
            [62, 0.5, 9],
            [64, 4.75, 4.75],
            [67, 9, 0.5],
        ]);
        expect(notes.map((note) => note.recordingPassIndex)).toEqual([0, 1, 2]);
        const recordedTakes = () => {
            const laneTakes = (takeLaneStore.value?.lanes ?? []).flatMap((lane) => lane.takes);
            const clipTakes = laneTakes.filter((take) => take.clipId === provisional.id);
            return clipTakes.map((take) => ({
                id: take.id,
                startBeat: take.startBeat,
                endBeat: take.endBeat,
                sourceOffsetBeats: take.sourceOffsetBeats,
                recordingPassIndex: take.recordingPassIndex,
            }));
        };
        const sealedTakes = recordedTakes();
        expect(sealedTakes.map((take) => [take.sourceOffsetBeats, take.recordingPassIndex])).toEqual([
            [8, 2],
            [0, 0],
            [4, 1],
        ]);
        expect(notes[0]?.expression).toMatchObject({
            slide: [{ offsetBeats: 4.25, value: 90 }],
            pressure: [{ offsetBeats: 4.25, value: 70 }],
            pitchBend: [{ offsetBeats: 4.25, value: 4096 }],
        });
        expect(committedEntryCount()).toBe(1);
        await undo();
        expect(midiStore.value?.notesByClipId[provisional.id] ?? []).toEqual([]);
        expect(recordedTakes()).toEqual([]);
        await redo();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);
        expect(recordedTakes()).toEqual(sealedTakes);
    });

    it('seals a latency-compensated physical onset at its heard pass beat while its worker is held', async () => {
        transportStore.set({
            ...transportStore.value!,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
            playheadPosition: 4,
        });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional MIDI clip');
        }
        flushAutomergeStorageWrites();
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        playheadClockRef.beat = 4.5;
        playheadClockRef.audioTimeSeconds = 0.5;
        mocks.audioClock.currentTime = 0.5;
        Object.defineProperty(audioEngine.context, 'currentTime', {
            configurable: true,
            get: () => mocks.audioClock.currentTime,
        });
        mocks.getCompensationDelay.mockReturnValue(0.25);
        const worker = Promise.withResolvers<void>();
        liveMidiGate.pending = worker.promise;

        const physical = handleWebMidiMessage({ data: new Uint8Array([0x91, 69, 100]), timeStamp: undefined });
        expect(activeRecordingRef.midiAdmissions.map((admitted) => admitted.onsetSourceBeat)).toEqual([0]);
        playheadClockRef.beat = 5;
        playheadClockRef.audioTimeSeconds = 0.75;
        mocks.audioClock.currentTime = 0.75;

        await stopActiveRecording();
        worker.resolve();
        await physical;

        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual([
            expect.objectContaining({ pitch: 69, startBeat: 0 }),
        ]);
        expect(committedEntryCount()).toBe(1);
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

    // The user's Stop writes an idle transport synchronously and commits the take
    // afterwards, so a caller that reads the transport must not call it idle yet.
    it('reads the transport as not idle until the audio take a user Stop closed has committed', async () => {
        await startAudioRecordingGesture();
        const release = gateNextCommit();

        const stopping = stopActiveRecording();
        expect(transportStore.value?.isRecording).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(isTransportIdle()).toBe(false);

        release();
        await stopping;
        expect(committedEntryCount()).toBe(1);
        expect(isTransportIdle()).toBe(true);
    });

    it('reads the transport as not idle until the MIDI take a user Stop closed has committed', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        const release = gateNextCommit();

        const stopping = stopActiveRecording();
        expect(transportStore.value?.isRecording).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(isTransportIdle()).toBe(false);

        release();
        await stopping;
        expect(committedEntryCount()).toBe(1);
        expect(isTransportIdle()).toBe(true);
    });

    it('does not resolve a later stop before the commit of the stop that came first', async () => {
        await startAudioRecordingGesture();
        const release = gateNextCommit();
        const first = stopActiveRecording();
        let laterResolved = false;

        // The recorder has nothing left to flush, so this stop's own flush is
        // immediate; only the first stop can say that the take has landed.
        const later = stopActiveRecording().then(() => {
            laterResolved = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(laterResolved).toBe(false);

        release();
        await Promise.all([first, later]);
        expect(committedEntryCount()).toBe(1);
    });

    it('counts a settled take commit for each take a stop closes, and none for a stop that closes nothing', async () => {
        const settledBefore = recordingLifecycle.settledCommitCount;
        await stopActiveRecording();
        expect(recordingLifecycle.settledCommitCount).toBe(settledBefore);

        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        await stopActiveRecording();
        expect(recordingLifecycle.settledCommitCount).toBeGreaterThan(settledBefore);
    });

    it('waits for an automatic punch-out commit before the user-facing stop resolves', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();

        const release = gateNextCommit();
        // Exactly what the scheduler's automatic punch-out does: finalize the
        // take and hand its commit to the recording lifecycle, without awaiting.
        finalizeAutomaticRecording(8);
        // The finalizer cleared the active ref, so Stop's own `stopRecording` is
        // a no-op; only an owned commit can keep Stop pending.
        let settled = false;
        const stopping = stopActiveRecording().then(() => {
            settled = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);
        release();
        await stopping;
        expect(committedEntryCount()).toBe(1);
        expect(findClip(provisional.id)?.endBeat).toBe(8);
    });

    it('punch-out seals an admitted MIDI key before its live worker returns', async () => {
        transportStore.set({
            ...transportStore.value!,
            isLooping: true,
            loopStart: 4,
            loopEnd: 8,
            playheadPosition: 4,
        });
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional MIDI clip');
        }
        flushAutomergeStorageWrites();
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        playheadClockRef.beat = 6;
        playheadClockRef.audioTimeSeconds = 1;
        mocks.audioClock.currentTime = 1;
        Object.defineProperty(audioEngine.context, 'currentTime', {
            configurable: true,
            get: () => mocks.audioClock.currentTime,
        });
        const worker = Promise.withResolvers<void>();
        liveMidiGate.pending = worker.promise;
        const physical = handleWebMidiMessage({ data: new Uint8Array([0x91, 72, 100]), timeStamp: undefined });
        expect(activeRecordingRef.midiAdmissions.map((admitted) => admitted.onsetSourceBeat)).toEqual([2]);
        playheadClockRef.beat = 8;
        playheadClockRef.audioTimeSeconds = 2;
        mocks.audioClock.currentTime = 2;

        finalizeAutomaticRecording(8);
        await stopActiveRecording();
        worker.resolve();
        await physical;

        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual([
            expect.objectContaining({ pitch: 72, startBeat: 2 }),
        ]);
        expect(committedEntryCount()).toBe(1);
        await undo();
        expect(midiStore.value?.notesByClipId[provisional.id] ?? []).toEqual([]);
    });

    it('retires the provisional MIDI recording when the commit is refused, and tells the user', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        // The project mutation gate refuses `executeAppAction`; the dispatch must
        // surface that refusal so the retirement and its notice still run.
        agentProjectRepairStateStore.set(repairRequired);

        await stopActiveRecording();
        flushAutomergeStorageWrites();

        expect(committedEntryCount()).toBe(0);
        expect(clipIds()).toEqual([]);
        expect(takeRefs()).toEqual([]);
        expect(laneIds()).toEqual([]);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording failed — the take was discarded. Try recording again.',
            'error'
        );
    });

    it('retires the provisional audio recording when the commit is refused, and tells the user', async () => {
        await startAudioRecordingGesture();
        expect(clipIds()).toHaveLength(1);
        agentProjectRepairStateStore.set(repairRequired);

        await stopActiveRecording();
        flushAutomergeStorageWrites();

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
