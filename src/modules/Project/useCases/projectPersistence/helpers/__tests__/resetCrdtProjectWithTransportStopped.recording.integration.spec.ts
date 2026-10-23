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
import { transportStore } from '#/modules/Transport/stores';
import { stopPlayback, togglePlayback, toggleRecording, watchClosedTakes } from '#/modules/Transport/useCases';

import { resetCrdtProjectWithTransportStopped } from '../resetCrdtProjectWithTransportStopped';

const TRACK_ID = 'track-recording';

type RecordingTerminal = (result: { kind: 'completed'; buffer: { duration: number } }) => void;
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
            terminal?.({ kind: 'completed', buffer: { duration: 2 } });
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
    transportStore.set({ ...transportStore.value!, isPlaying: true });
    toggleRecording();
    await vi.waitFor(() => {
        expect(clipIds()).toHaveLength(1);
    });
    flushAutomergeStorageWrites();
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

function replace(
    closedTakes: ReturnType<typeof watchClosedTakes> = watchClosedTakes()
): ReturnType<typeof resetCrdtProjectWithTransportStopped> {
    return resetCrdtProjectWithTransportStopped('Next', vi.fn(), () => true, closedTakes);
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
        mocks.saveProject.mockImplementation(() => {
            mocks.events.push(`save:${String(committedEntryCount())}`);
            return Promise.resolve(true);
        });
        mocks.resetCrdtProject.mockReset();
        replaceOnlyWhenIdle();
        mocks.audioClock.currentTime = 0;
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
        const closedTakes = watchClosedTakes();
        await stopPlayback();

        await expect(replace(closedTakes)).resolves.toMatchObject({ status: 'replaced' });

        expect(mocks.events).toEqual(['save:1', 'switch']);
    });

    it('tells the user the take is discarded when the outgoing project cannot be saved, and still replaces', async () => {
        openMidiTake();
        mocks.saveProject.mockResolvedValue(false);

        await expect(replace()).resolves.toMatchObject({ status: 'replaced' });

        expect(mocks.events).toEqual(['refused', 'switch']);
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
