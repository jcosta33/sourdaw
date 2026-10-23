import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, startRecording } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { playheadClockRef, playheadPositionRef, transportStore } from '#/modules/Transport/stores';
import {
    countSettledTakes,
    isTransportIdle,
    stopPlayback,
    togglePlayback,
    toggleRecording,
} from '#/modules/Transport/useCases';

import { pickAndImportProjectFile } from '../../fileIO/pickAndImportProjectFile';
import { saveProjectBeforeReplacement } from '../../saveProject/saveProjectBeforeReplacement';
import { resetCrdtProjectWithTransportStopped } from '../resetCrdtProjectWithTransportStopped';
import { unsavedClosedTakes } from '../unsavedClosedTakes';

const TRACK_ID = 'track-recording';

type RecordingTerminal = (result: {
    kind: 'completed';
    buffer: { duration: number };
    sampleZeroContextFrame: number;
    sampleRate: number;
}) => void;
type ResetAttempt = (name: string, onAuthorityReplaced: () => void, isIdle: () => boolean) => Promise<unknown>;

const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    let capturedAudioTerminal: RecordingTerminal | null = null;
    return {
        audioClock,
        events: [] as string[],
        getAudioContext: vi.fn(() => audioClock),
        getCompensationDelay: vi.fn(() => 0),
        cacheAudioBuffer: vi.fn(),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        pickFiles: vi.fn<() => Promise<File[] | null>>(),
        replaceImportedProject: vi.fn<() => Promise<boolean>>(),
        resetAudioGraph: vi.fn(),
        unloadPlugin: vi.fn<() => Promise<void>>(() => Promise.resolve()),
        saveProject: vi.fn<() => Promise<boolean>>(),
        resetCrdtProject: vi.fn<ResetAttempt>(),
        startAudioRecording: vi.fn<(trackId: string, terminal: RecordingTerminal) => Promise<boolean>>(
            (_trackId, terminal) => {
                capturedAudioTerminal = terminal;
                return Promise.resolve(true);
            }
        ),
        // The real flush settles the capture and invokes its terminal; this mock
        // does the same, so the tracked commit is registered where it is in
        // production.
        stopAudioRecording: vi.fn<() => Promise<void>>(() => {
            const terminal = capturedAudioTerminal;
            capturedAudioTerminal = null;
            terminal?.({
                kind: 'completed',
                buffer: { duration: 2 },
                sampleZeroContextFrame: 0,
                sampleRate: 48000,
            });
            return Promise.resolve();
        }),
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    cacheAudioBuffer: mocks.cacheAudioBuffer,
    getAudioContext: mocks.getAudioContext,
    getCompensationDelay: mocks.getCompensationDelay,
    resetAudioGraph: mocks.resetAudioGraph,
    startAudioRecording: mocks.startAudioRecording,
    stopAudioRecording: mocks.stopAudioRecording,
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    unloadPlugin: mocks.unloadPlugin,
}));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    resetCrdtProject: mocks.resetCrdtProject,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('../../saveProject/saveProject', () => ({ saveProject: mocks.saveProject }));
vi.mock('../../../fileDialog', () => ({ pickFiles: mocks.pickFiles }));
// The import's replacement, reduced to the reset helper it ends in.
vi.mock('../../fileIO/applyImportedProjectData', () => ({ applyImportedProjectData: mocks.replaceImportedProject }));

/** Holds the next `commitRecording` after its transaction has landed. */
const commitGate = vi.hoisted(() => ({
    pending: null as Promise<void> | null,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        executeAppAction: async (...args: Parameters<typeof actual.executeAppAction>) => {
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

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

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

function clipIds(): string[] {
    return (trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips ?? []).map((clip) => clip.id);
}

function seedTrack(kind: 'audio' | 'midi'): void {
    trackStore.set({ tracks: [recordingTrack(kind)], selectedTrackId: TRACK_ID, ghostClips: [] });
    takeLaneStore.set({ lanes: [] });
    transportStore.set({
        ...transportStore.value!,
        isPlaying: false,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: false,
        playheadPosition: 4,
    });
}

/** A MIDI take the transport is recording, open until something stops it. */
function openMidiTake(): void {
    seedTrack('midi');
    startRecording(4);
    transportStore.set({ ...transportStore.value!, isRecording: true });
    flushAutomergeStorageWrites();
}

/**
 * An audio take opened through the Record toggle on a rolling transport, as the
 * user does it. The transport is already rolling so that Record does not start
 * the scheduler's worker.
 */
async function openAudioTake(): Promise<void> {
    seedTrack('audio');
    playheadClockRef.beat = 4;
    playheadClockRef.audioTimeSeconds = 0;
    playheadPositionRef.current = 4;
    transportStore.set({ ...transportStore.value!, isPlaying: true });
    toggleRecording();
    await vi.waitFor(() => {
        expect(clipIds()).toHaveLength(1);
    });
    flushAutomergeStorageWrites();
    // PCM frames [0, 96000) at 48 kHz span beats [4, 8) at 120 BPM.
    // Pause freezes this terminal beat before its flush completes the capture.
    mocks.audioClock.currentTime = 2;
    playheadClockRef.beat = 8;
    playheadClockRef.audioTimeSeconds = 2;
    playheadPositionRef.current = 8;
}

/**
 * The reset's contract at its switch: after the durable steps it awaits, it
 * asks the transport check it was handed in the same synchronous turn as the
 * replacement, and answers `transport-active` without replacing anything.
 */
function replaceOnlyWhenIdle(): void {
    mocks.resetCrdtProject.mockImplementation(async (_name, onAuthorityReplaced, isIdle) => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!isIdle()) {
            mocks.events.push('refused');
            return { status: 'transport-active' };
        }
        mocks.events.push('switch');
        onAuthorityReplaced();
        return { status: 'replaced', finalize: vi.fn() };
    });
}

function replace(): ReturnType<typeof resetCrdtProjectWithTransportStopped> {
    return resetCrdtProjectWithTransportStopped('Next', vi.fn(), () => true);
}

/**
 * The Save command's contract: the save records the takes in the project, and a
 * successful one records the settled-take count read at its snapshot.
 */
function saveRecordingTakes(saved = true): Promise<boolean> {
    const settledAtSnapshot = countSettledTakes();
    mocks.events.push(`save:${String(committedEntryCount())}`);
    if (saved) {
        unsavedClosedTakes.markSavedThrough(settledAtSnapshot);
    }
    return Promise.resolve(saved);
}

/** The read a route makes before it replaces the project: the user's take lands meanwhile. */
async function readWhileTheTakeLands(releaseCommit: () => void): Promise<void> {
    releaseCommit();
    await vi.waitFor(() => {
        expect(isTransportIdle()).toBe(true);
    });
}

/** The user's own Pause on a rolling transport recording a MIDI take, whose commit is held. */
function pauseWhileTheCommitIsHeld(): () => void {
    seedTrack('midi');
    transportStore.set({ ...transportStore.value!, isPlaying: true });
    startRecording(4);
    transportStore.set({ ...transportStore.value!, isRecording: true });
    flushAutomergeStorageWrites();
    const release = gateNextCommit();
    togglePlayback();
    expect(transportStore.value?.isPlaying).toBe(false);
    expect(transportStore.value?.isRecording).toBe(false);
    return release;
}

describe('replacing a project while a take is recording or closing (issue #5500)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('replacement closing take');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        mocks.events.length = 0;
        mocks.notifyUser.mockClear();
        mocks.resetAudioGraph.mockReset();
        mocks.unloadPlugin.mockReset();
        mocks.unloadPlugin.mockResolvedValue(undefined);
        mocks.saveProject.mockReset();
        mocks.saveProject.mockImplementation(() => saveRecordingTakes());
        mocks.pickFiles.mockReset();
        mocks.replaceImportedProject.mockReset();
        mocks.resetCrdtProject.mockReset();
        replaceOnlyWhenIdle();
        mocks.audioClock.currentTime = 0;
        // Each case opens with a project that owes nothing for the takes before it.
        unsavedClosedTakes.acknowledgeAll();
    });

    afterEach(async () => {
        await stopPlayback();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('saves the outgoing project, take included, before the authority switch when the stop commits a take', async () => {
        openMidiTake();

        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });

        expect(committedEntryCount()).toBe(1);
        expect(mocks.events).toEqual(['refused', 'save:1', 'switch']);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('saves a take that a stop made before the helper ran committed, before it asks the reset at all', async () => {
        openMidiTake();
        await stopPlayback();

        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });

        expect(mocks.events).toEqual(['save:1', 'switch']);
    });

    // Open Recent: the menu's pre-save runs right after the user's Stop, before
    // the take has landed, and the take lands while the load reads the project
    // it is about to open.
    it('saves a take that lands after the pre-save and during the read before a recent-project load switches', async () => {
        const release = pauseWhileTheCommitIsHeld();

        await expect(saveProjectBeforeReplacement()).resolves.toBe(true);
        await readWhileTheTakeLands(release);
        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });

        expect(committedEntryCount()).toBe(1);
        expect(mocks.events).toEqual(['save:0', 'save:1', 'switch']);
    });

    it('saves a take that lands while an imported file is read before the import switches', async () => {
        const release = pauseWhileTheCommitIsHeld();
        const file = new File(['{}'], 'song.sourdaw');
        vi.spyOn(file, 'text').mockImplementation(async () => {
            await readWhileTheTakeLands(release);
            return '{}';
        });
        mocks.pickFiles.mockResolvedValue([file]);
        mocks.replaceImportedProject.mockImplementation(async () => {
            const reset = await replace();
            return reset.status === 'replaced';
        });

        await expect(pickAndImportProjectFile()).resolves.toBe(true);

        expect(committedEntryCount()).toBe(1);
        expect(mocks.events.slice(-2)).toEqual(['save:1', 'switch']);
    });

    it('does not save again at a replacement for a take that a save already kept', async () => {
        openMidiTake();
        await stopPlayback();
        // The user's Save, or the autosave, after the take landed.
        await saveRecordingTakes();
        mocks.events.length = 0;

        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });

        expect(mocks.saveProject).not.toHaveBeenCalled();
        expect(mocks.events).toEqual(['switch']);
    });

    it('owes the project it switched to nothing for the takes of the project it left', async () => {
        openMidiTake();
        await stopPlayback();
        mocks.saveProject.mockImplementation(() => saveRecordingTakes(false));
        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });
        mocks.saveProject.mockClear();
        mocks.events.length = 0;

        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });

        expect(mocks.saveProject).not.toHaveBeenCalled();
        expect(mocks.events).toEqual(['switch']);
    });

    // Cycle punch recording: the transport rolls on and a take closes on every
    // pass, so one lands during every save.
    it('resolves the pre-save after one save while takes keep landing, and saves the later take before the switch', async () => {
        openMidiTake();
        transportStore.set({ ...transportStore.value!, isPlaying: true });
        let cyclePasses = 0;
        mocks.saveProject.mockImplementation(async () => {
            const saved = await saveRecordingTakes();
            // Bounded, so a pre-save that saves again for each landed take ends
            // and its extra saves show.
            if (cyclePasses < 3) {
                cyclePasses += 1;
                // The pass ends: its take closes and the next pass opens one.
                toggleRecording();
                startRecording(4 + cyclePasses);
                transportStore.set({ ...transportStore.value!, isRecording: true });
                flushAutomergeStorageWrites();
            }
            return saved;
        });

        await expect(saveProjectBeforeReplacement()).resolves.toBe(true);

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(transportStore.value?.isPlaying).toBe(true);
        // The user stops the cycle only now, through the replacement's own stop.
        cyclePasses = Number.POSITIVE_INFINITY;

        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });

        expect(committedEntryCount()).toBe(2);
        expect(mocks.events.at(0)).toBe('save:0');
        expect(mocks.events.slice(-2)).toEqual(['save:2', 'switch']);
    });

    it('tells the user the take is discarded when the outgoing project cannot be saved, and still replaces', async () => {
        openMidiTake();
        mocks.saveProject.mockImplementation(() => saveRecordingTakes(false));

        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });

        expect(mocks.events).toEqual(['refused', 'save:1', 'switch']);
        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Recording discarded — the take could not be saved to the project you are leaving.',
            'warning'
        );
    });

    it('does not save an outgoing project in which no take closed', async () => {
        seedTrack('midi');

        await replace();

        expect(mocks.saveProject).not.toHaveBeenCalled();
        expect(mocks.events).toEqual(['switch']);
    });

    it('does not switch authority while a take the user stopped is still committing, then saves it', async () => {
        await openAudioTake();
        const release = gateNextCommit();
        // The user's own Pause: the transport turns idle at once, the commit does not.
        togglePlayback();
        expect(transportStore.value?.isPlaying).toBe(false);
        expect(transportStore.value?.isRecording).toBe(false);

        const replacing = replace();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mocks.events).not.toContain('switch');

        release();
        await expect(replacing).resolves.toMatchObject({ status: 'replaced' });

        expect(committedEntryCount()).toBe(1);
        expect(mocks.events).toEqual(['refused', 'save:1', 'switch']);
    });

    // No audio capture is open here, so the commit this stop started is the only
    // thing that says a take is still landing: the transport already reads
    // stopped, and no commit has settled for the settled-take count to show.
    it('does not switch authority while a MIDI take the user paused is still committing, then saves it', async () => {
        const release = pauseWhileTheCommitIsHeld();

        const replacing = replace();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mocks.events).not.toContain('switch');

        release();
        await expect(replacing).resolves.toMatchObject({ status: 'replaced' });

        expect(committedEntryCount()).toBe(1);
        expect(mocks.events).toEqual(['refused', 'save:1', 'switch']);
    });

    it('resets the audio graph and unloads the plugins again before the switch when a Play lands during the plugin unload', async () => {
        seedTrack('midi');
        // The caller's own teardown, with a Play landing while the plugins unload.
        mocks.resetAudioGraph.mockImplementation(() => {
            mocks.events.push('reset-graph');
        });
        mocks.unloadPlugin.mockImplementation(() => {
            mocks.events.push('unload-plugins');
            transportStore.set({ ...transportStore.value!, isPlaying: true });
            return Promise.resolve();
        });
        mocks.resetAudioGraph();
        await mocks.unloadPlugin();
        mocks.unloadPlugin.mockImplementation(() => {
            mocks.events.push('unload-plugins');
            return Promise.resolve();
        });

        await replace();

        expect(transportStore.value?.isPlaying).toBe(false);
        expect(mocks.events).toEqual([
            'reset-graph',
            'unload-plugins',
            'refused',
            'reset-graph',
            'unload-plugins',
            'switch',
        ]);
    });
});
