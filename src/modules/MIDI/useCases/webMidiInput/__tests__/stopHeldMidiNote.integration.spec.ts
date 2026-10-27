import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import {
    admitRecordingMidiExpression,
    admitRecordingMidiNoteOff,
    admitRecordingMidiNoteOn,
    findOpenRecordingMidiAdmission,
    findOpenRecordingMidiMemberAdmission,
    getRecordingMidiAdmission,
    getArrangementHandlers,
    retireRecordingMidiAdmission,
    startRecording,
    takeOwnsRecordingRoot,
    recordingMidiSourceBeatAt,
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
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultMidiStoreState, midiStore } from '#/modules/MIDI/stores';
import { setMidiInputTrack, setRecordingMidiAdmissionPort } from '#/modules/MIDI/useCases';
import { playheadWrapCountRef, transportStore } from '#/modules/Transport/stores';
import { stopPlayback } from '#/modules/Transport/useCases';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';
import { setMpeEnabledInternal } from '../../../repositories/webMidi/setMpeEnabledInternal';
import { activeNotes } from '../../../repositories/webMidi/state';

const TRACK_ID = 'track-recording';
let disposeRecordingAdmission = (): void => {};

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
vi.mock('../handleWebMidiNoteOn', () => ({
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

function committedEntryCount(): number {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    ).length;
}

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
        disposeRecordingAdmission = setRecordingMidiAdmissionPort({
            admitRecordingMidiNoteOn,
            admitRecordingMidiNoteOff,
            admitRecordingMidiExpression,
            findOpenRecordingMidiAdmission,
            findOpenRecordingMidiMemberAdmission,
            getRecordingMidiAdmission,
            retireRecordingMidiAdmission,
            takeOwnsRecordingRoot,
            recordingMidiSourceBeatAt,
        });
        activeNotes.clear();
        setMidiInputTrack(TRACK_ID);
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
        setMidiInputTrack(null);
        disposeRecordingAdmission();
        setMpeEnabledInternal(false);
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
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

        await stopPlayback();

        const notes = midiStore.value?.notesByClipId[provisional.id] ?? [];
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ pitch: 60, velocity: 100 });
        expect(committedEntryCount()).toBe(1);
        await undo();
        expect(midiStore.value?.notesByClipId[provisional.id] ?? []).toEqual([]);
        await redo();
        expect(midiStore.value?.notesByClipId[provisional.id]).toEqual(notes);
    });
});
