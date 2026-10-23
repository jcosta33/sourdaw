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
import { stopPlayback, togglePlayback } from '#/modules/Transport/useCases';

import { saveProjectBeforeReplacement } from '../saveProjectBeforeReplacement';

const TRACK_ID = 'track-recording';

const mocks = vi.hoisted(() => ({
    audioClock: { currentTime: 0, baseLatency: 0, outputLatency: 0 },
    saveProject: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: () => mocks.audioClock,
    getCompensationDelay: () => 0,
    // A rolling transport schedules the armed track; the clock above is no
    // AudioContext, so the strip it schedules into holds no device.
    ensureTrackStrip: () => ({ deviceNodes: [] }),
    nativeLiveGraphSessionOffered: () => false,
    resumeEngine: () => Promise.resolve(),
    stopAudioRecording: () => Promise.resolve(),
}));

type SchedulerWorkerStub = {
    onmessage: ((event: { data: unknown }) => void) | null;
    generation: number;
};

/** The scheduler's clock worker: the test sends each tick the worker would. */
const schedulerWorkers = vi.hoisted(() => ({ live: null as SchedulerWorkerStub | null, sequence: 0 }));

class SchedulerWorker implements SchedulerWorkerStub {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    generation = 0;

    constructor() {
        schedulerWorkers.live = this;
    }

    postMessage(message: { type: string; generation?: number }): void {
        if (message.type === 'start' && message.generation !== undefined) {
            this.generation = message.generation;
        }
    }

    terminate(): void {
        if (schedulerWorkers.live === this) {
            schedulerWorkers.live = null;
        }
    }
}

/** Advance the audio clock and let the scheduler run the tick the worker sends then. */
async function tickSchedulerAt(audioSeconds: number): Promise<void> {
    mocks.audioClock.currentTime = audioSeconds;
    const worker = schedulerWorkers.live;
    if (!worker) {
        throw new Error('the transport has no scheduler worker to tick');
    }
    schedulerWorkers.sequence += 1;
    const sentAtMs = performance.timeOrigin + performance.now();
    worker.onmessage?.({
        data: {
            type: 'tick',
            generation: worker.generation,
            sequence: schedulerWorkers.sequence,
            scheduledAtMs: sentAtMs - 1,
            sentAtMs,
        },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
}
vi.mock('../saveProject', () => ({ saveProject: mocks.saveProject }));

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

function midiRecordingTrack(): Track {
    return {
        id: TRACK_ID,
        name: 'MIDI',
        kind: 'midi',
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

/** A MIDI take on a rolling transport, open until the user's Pause stops it. */
function openMidiTakeOnARollingTransport(): void {
    trackStore.set({ tracks: [midiRecordingTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
    takeLaneStore.set({ lanes: [] });
    transportStore.set({
        ...transportStore.value!,
        isPlaying: true,
        isRecording: false,
        countInEnabled: false,
        punchInEnabled: false,
        playheadPosition: 4,
    });
    startRecording(4);
    transportStore.set({ ...transportStore.value!, isRecording: true });
    flushAutomergeStorageWrites();
}

describe('the pre-save of a replacement right after the user stops a recording (issue #5500)', () => {
    const takesInEachSave: number[] = [];

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('pre-save closing take');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        takesInEachSave.length = 0;
        mocks.saveProject.mockReset();
        mocks.saveProject.mockImplementation(() => {
            takesInEachSave.push(committedEntryCount());
            return Promise.resolve(true);
        });
        mocks.audioClock.currentTime = 0;
    });

    afterEach(async () => {
        await stopPlayback();
        vi.unstubAllGlobals();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('saves the project only after the take the Stop is still committing has landed in it', async () => {
        openMidiTakeOnARollingTransport();
        const release = gateNextCommit();
        // The user's own Pause: the transport turns idle at once, the commit does not.
        togglePlayback();
        expect(transportStore.value?.isRecording).toBe(false);

        const saving = saveProjectBeforeReplacement();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mocks.saveProject).not.toHaveBeenCalled();

        release();
        await expect(saving).resolves.toBe(true);

        expect(takesInEachSave).toEqual([1]);
    });

    it('saves the project only after the take a punch-out is still committing has landed, while the transport rolls on', async () => {
        vi.stubGlobal('Worker', SchedulerWorker);
        trackStore.set({ tracks: [midiRecordingTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({
            ...transportStore.value!,
            isPlaying: false,
            isRecording: false,
            isLooping: false,
            countInEnabled: false,
            preRollEnabled: false,
            punchInEnabled: true,
            punchInBeat: 4,
            punchOutBeat: 4.5,
            playheadPosition: 3.9,
            tempo: 120,
        });
        flushAutomergeStorageWrites();

        togglePlayback();
        // Rolls across the punch-in, then across the punch-out: the scheduler
        // closes the take on its own, with no Stop closing it.
        await tickSchedulerAt(0.1);
        expect(transportStore.value?.isRecording).toBe(true);
        const release = gateNextCommit();
        try {
            for (let tick = 2; tick <= 10 && transportStore.value?.isRecording; tick++) {
                await tickSchedulerAt(tick / 10);
            }
            expect(transportStore.value?.isRecording).toBe(false);
            expect(transportStore.value?.isPlaying).toBe(true);

            const saving = saveProjectBeforeReplacement();
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(mocks.saveProject).not.toHaveBeenCalled();

            release();
            await expect(saving).resolves.toBe(true);
        } finally {
            release();
        }

        expect(takesInEachSave).toEqual([1]);
        expect(transportStore.value?.isPlaying).toBe(true);
    });
});
