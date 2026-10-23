import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, startRecording } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    agentProjectInspectionPort,
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { handleRepairProjectData } from '../../handlers/project/handleRepairProjectData';
import { repairProjectData } from '../repairProjectData';

const TRACK_ID = 'track-recording';

const mocks = vi.hoisted(() => {
    const audioClock = { currentTime: 0, baseLatency: 0, outputLatency: 0 };
    return {
        audioClock,
        getAudioContext: vi.fn(() => audioClock),
        getCompensationDelay: vi.fn(() => 0),
        notifyUser: vi.fn<(message: string, level: string) => void>(),
        stopAudioRecording: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    };
});

// Only the audio capture is replaced: a MIDI take has none, and everything
// else the real stop touches is the real module graph.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getAudioContext: mocks.getAudioContext,
    getCompensationDelay: mocks.getCompensationDelay,
    stopAudioRecording: mocks.stopAudioRecording,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function armedMidiTrack(): Track {
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

function recordedClipSpan(): { startBeat: number; endBeat: number } | null {
    const clip = trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.clips[0];
    return clip === undefined ? null : { startBeat: clip.startBeat, endBeat: clip.endBeat };
}

function recordedTakeSpan(): { startBeat: number; endBeat: number } | null {
    const take = takeLaneStore.value?.lanes.flatMap((lane) => lane.takes)[0];
    return take === undefined ? null : { startBeat: take.startBeat, endBeat: take.endBeat };
}

function raiseRepairGate(): void {
    agentProjectRepairStateStore.set({
        audioGraphValid: false,
        detectedRevision: 'repair-revision',
        inspectionAvailable: true,
        projectInvariantsValid: false,
        rawProjectRetained: true,
        repairCandidates: [{ kind: 'repair-project-invariants', targetIds: [] }],
        status: 'repair-required',
    });
}

function committedRecordingEntries(): unknown[] {
    return (undoHistoryStore.value?.past ?? []).filter(
        (entry) => entry.kind === 'action' && entry.action.type === 'commitRecording'
    );
}

/**
 * A repair re-projects every store from the document, and the projection
 * releases any write a store still holds unflushed. A take the user was
 * recording when they pressed Repair is closed (or, under the gate this repair
 * lifts, retired) by exactly such writes, so the repair has to have stopped the
 * transport and landed the result before it dispatches: otherwise the clip keeps
 * the end beat it was closed at while its take reverts to the one it was opened
 * with.
 */
describe('repairProjectData while a MIDI take is recording', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('repair while recording');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        agentProjectInspectionPort.setProvider(() => ({
            audioGraphValid: true,
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        clearHandlerRegistry();
        registerHandlerMap({ ...getArrangementHandlers(), repairProjectData: handleRepairProjectData });
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({ tracks: [armedMidiTrack()], selectedTrackId: TRACK_ID, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({
            ...transportStore.value!,
            isPlaying: false,
            isRecording: true,
            playheadPosition: 12,
        });
        mocks.notifyUser.mockClear();
    });

    afterEach(() => {
        agentProjectRepairStateStore.set(null);
        agentProjectInspectionPort.setProvider(null);
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.unstubAllGlobals();
    });

    it('retires the clip and its take together, as a plain Stop does under the gate, and leaves no entry behind', async () => {
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        // The gate comes up mid-take, as a merged conflict would raise it. It
        // refuses the take's commit, so the Stop the repair starts retires it.
        raiseRepairGate();

        await expect(repairProjectData()).resolves.toBe('repaired');
        flushAutomergeStorageWrites();

        expect(agentProjectRepairStateStore.value).toBeNull();
        // A clip that kept its recorded end while its take reverted to the
        // beat it opened on (4-12 against 4-4) is the split this guards.
        expect(recordedClipSpan()).toBeNull();
        expect(recordedTakeSpan()).toBeNull();
        expect(committedRecordingEntries()).toHaveLength(0);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Recording failed — the take was discarded. Try recording again.',
            'error'
        );
        expect(transportStore.value?.isRecording).toBe(false);
    });
});
