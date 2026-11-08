import { toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import { createMockAudioContext } from '#/helpers/__tests__/audioContext.mock';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { audioBufferCache } from '#/modules/AudioEngine/stores';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    isExecutableAppActionType,
    productionBriefAdmissionPort,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import {
    captureDurableDocumentWitness,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { addMidiCC, addPitchBend } from '#/modules/MIDI/useCases';
import { productionBriefActionBatchAdmission } from '#/modules/Project/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { isRecord } from '#/utils/structuralEquality';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { setArrangementEventBus } from '../../../useCases/arrangementEventBus';
import { admitRecordingMidiNoteOn } from '../../../useCases/recording/admitRecordingMidiNoteOn';
import { commitRecording } from '../../../useCases/recording/commitRecording';
import { stageRecordingTake } from '../../../useCases/recording/stageRecordingTake';
import { startRecording } from '../../../useCases/recording/startRecording';
import { stopRecording } from '../../../useCases/recording/stopRecording';
import { isRecordingRestoreSessionPayload } from '../recordingSessionEntry';

const PROJECT_ID = 'recording-session-project';
const AUDIO = 'recording-session-audio';
const MIDI = 'recording-session-midi';
const SESSION_KEY = 'sourdaw-undo-session';
const noMetadata = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function registerProductionSession(): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

function savedMirror() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
        throw new Error('Recording session did not write its actual mirror');
    }
    return JSON.parse(raw) as { past: unknown[]; future: unknown[]; projectId: string; witness: string };
}

function snapshot() {
    flushAutomergeStorageWrites();
    const raw = toJS(getCrdtDoc('root')!);
    return {
        raw,
        tracks: structuredClone(trackStore.value),
        takes: structuredClone(takeLaneStore.value),
        midi: structuredClone(midiStore.value),
    };
}

async function recordMixedGesture(shortAudio = false) {
    const ending = {
        contextSeconds: 0.5,
        rolling: true,
        beatAtContextSeconds: (seconds: number) => 4 + seconds * 2,
        midiPosition: { beat: 5, passIndex: 0 },
    };
    const clips = startRecording(
        4,
        () => 0,
        undefined,
        () => ({ status: 'bounded', startContextSeconds: 0, ending })
    );
    expect(clips).toHaveLength(2);
    const midi = clips.find((clip) => clip.trackId === MIDI)!;
    const audio = clips.find((clip) => clip.trackId === AUDIO)!;
    transportStore.set({ ...transportStore.value!, isRecording: true });
    expect(
        admitRecordingMidiNoteOn({
            trackId: MIDI,
            channel: 0,
            note: 67,
            velocity: 90,
            audioTime: 0.25,
            position: { beat: 4.5, passIndex: 0 },
        })
    ).not.toBeNull();
    addMidiCC(midi.id, 1, 91, 0.25, 0);
    addPitchBend(midi.id, 1024, 0.25, 0);
    const buffer = createMockAudioContext().createBuffer(1, 24_000, 48_000);
    for (let frame = 0; frame < buffer.length; frame++) {
        buffer.getChannelData(0)[frame] = frame / buffer.length;
    }
    audioBufferCache.set('session-pcm', buffer);
    // Stop finalizes both clips before the real audio terminal submits its publication.
    const closing = stopRecording(5, ending);
    const finalizedAudio = trackStore
        .value!.tracks.find((track) => track.id === AUDIO)!
        .clips.find((clip) => clip.id === audio.id)!;
    const payload = { ...finalizedAudio, audioBufferId: 'session-pcm', kneadState: undefined };
    if (shortAudio) {
        payload.endBeat = 4.5;
    }
    await commitRecording(payload);
    await closing;
    transportStore.set({ ...transportStore.value!, isRecording: false });
    flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    return { midiId: midi.id, audioId: audio.id, buffer };
}

function storedPayload(entry: unknown, key: 'action' | 'inverseAction' | 'redoAction'): Record<string, unknown> {
    if (!isRecord(entry) || !isRecord(entry[key]) || !isRecord(entry[key].payload)) {
        throw new Error('Expected a real serialized recording action payload');
    }
    return entry[key].payload;
}

function storedClip(entry: unknown): Record<string, unknown> {
    const payload = storedPayload(entry, 'redoAction');
    if (!isRecord(payload.clip)) {
        throw new Error('Expected the serialized recording clip');
    }
    return payload.clip;
}

function corruptRecordingEntry(entries: unknown[], corruption: string): void {
    const entry = entries.find((candidate) => storedClip(candidate).type === 'midi');
    if (!isRecord(entry)) {
        throw new Error('Expected the MIDI member of the actual mixed recording group');
    }
    const redo = storedPayload(entry, 'redoAction');
    const clip = storedClip(entry);
    switch (corruption) {
        case 'inverse':
            storedPayload(entry, 'inverseAction').clipId = 'foreign-clip';
            return;
        case 'family':
            entry.inverseAction = { type: 'removeClip', payload: { clipId: clip.id } };
            return;
        case 'orphan-restore':
            entry.action = entry.redoAction;
            return;
        case 'missing-redo':
            Reflect.deleteProperty(entry, 'redoAction');
            return;
        case 'version':
            entry.actionOperationVersion = 2;
            return;
        case 'track':
            clip.trackId = AUDIO;
            return;
        case 'type':
            clip.type = 'audio';
            return;
        case 'source': {
            const audio = entries.find((candidate) => storedClip(candidate).type === 'audio');
            storedClip(audio).audioBufferId = 'foreign-pcm';
            return;
        }
        case 'geometry':
            clip.endBeat = 6;
            return;
        case 'take-owner': {
            if (
                !Array.isArray(redo.retiredTakeLanes) ||
                !isRecord(redo.retiredTakeLanes[0]) ||
                !isRecord(redo.retiredTakeLanes[0].lane)
            ) {
                throw new Error('Expected a captured recording lane');
            }
            redo.retiredTakeLanes[0].lane.trackId = AUDIO;
            return;
        }
        case 'note': {
            if (!Array.isArray(redo.midiNotesSnapshot) || !isRecord(redo.midiNotesSnapshot[0])) {
                throw new Error('Expected actual captured note data');
            }
            redo.midiNotesSnapshot[0].duration = 'half';
            return;
        }
        case 'controller': {
            if (!Array.isArray(redo.midiCcSnapshot) || !isRecord(redo.midiCcSnapshot[0])) {
                throw new Error('Expected actual captured controller data');
            }
            redo.midiCcSnapshot[0].value = '91';
            return;
        }
        case 'pass': {
            if (!Array.isArray(redo.midiNotesSnapshot) || !isRecord(redo.midiNotesSnapshot[0])) {
                throw new Error('Expected recorded note');
            }
            redo.midiNotesSnapshot[0].recordingPassIndex = -1;
            return;
        }
        case 'expression': {
            if (!Array.isArray(redo.midiNotesSnapshot) || !isRecord(redo.midiNotesSnapshot[0])) {
                throw new Error('Expected recorded note');
            }
            redo.midiNotesSnapshot[0].expression = { pressure: [{ offsetBeats: 2, value: 80 }] };
            return;
        }
        case 'take-source': {
            if (
                !Array.isArray(redo.retiredTakeLanes) ||
                !isRecord(redo.retiredTakeLanes[0]) ||
                !isRecord(redo.retiredTakeLanes[0].lane) ||
                !Array.isArray(redo.retiredTakeLanes[0].lane.takes) ||
                !isRecord(redo.retiredTakeLanes[0].lane.takes[0])
            ) {
                throw new Error('Expected captured take');
            }
            Object.assign(redo.retiredTakeLanes[0].lane.takes[0], {
                passAnchorSeconds: 0,
                passDepthSeconds: 1,
                passSourceEndSeconds: 0.5,
            });
            return;
        }
        case 'snapshot':
            Reflect.deleteProperty(redo, 'midiCcSnapshot');
            return;
        default:
            throw new Error('Unknown recording corruption control');
    }
}

describe('recording production session mirror', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('recording serialized session');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearUndoHistory();
        resetActionReplayAuthority();
        sessionStorage.removeItem(SESSION_KEY);
        setActionHistoryMetadataPort(noMetadata);
        productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [
                TrackDummy.create({ id: AUDIO, kind: 'audio', armed: true, clips: [] }),
                TrackDummy.create({ id: MIDI, kind: 'midi', armed: true, clips: [] }),
            ],
            selectedTrackId: MIDI,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        midiStore.set({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 4 });
        setArrangementEventBus(createEventBus());
        flushAutomergeStorageWrites();
        registerProductionSession();
    });
    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        audioBufferCache.remove('session-pcm');
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        sessionStorage.removeItem(SESSION_KEY);
    });

    it('serializes both actual mixed recording entries and hydrates past and future as one replay group', async () => {
        const { midiId, buffer } = await recordMixedGesture();
        expect(midiStore.value!.notesByClipId[midiId]).toHaveLength(1);
        expect(undoHistoryStore.value!.past).toHaveLength(2);
        expect(savedMirror().past).toHaveLength(2);
        expect(savedMirror().witness).toBe(captureDurableDocumentWitness());
        const recorded = snapshot();
        const liveEntries = undoHistoryStore.value!.past;
        undoHistoryStore.set({ past: [], future: [] });
        registerProductionSession();
        expect(undoHistoryStore.value!.past).toHaveLength(2);
        expect(undoHistoryStore.value!.past[0]).not.toBe(liveEntries[0]);
        for (let cycle = 0; cycle < 2; cycle++) {
            await undo();
            expect(trackStore.value!.tracks.flatMap((track) => track.clips)).toEqual([]);
            expect(takeLaneStore.value!.lanes).toEqual([]);
            expect(midiStore.value!.notesByClipId[midiId]).toBeUndefined();
            flushAutomergeStorageWrites();
            stampSessionUndoWitness();
            expect(savedMirror().future).toHaveLength(2);
            undoHistoryStore.set({ past: [], future: [] });
            registerProductionSession();
            expect(undoHistoryStore.value!.future).toHaveLength(2);
            await redo();
            expect(snapshot()).toEqual(recorded);
            expect(audioBufferCache.get('session-pcm')).toBe(buffer);
            expect(buffer.getChannelData(0)[23_999]).toBeCloseTo(23_999 / 24_000, 7);
        }
        for (const type of ['commitRecording', 'discardRecording', 'restoreRecording']) {
            expect(isExecutableAppActionType(type)).toBe(false);
        }
    });
    for (const side of ['past', 'future'] as const) {
        it.each([
            'inverse',
            'family',
            'orphan-restore',
            'missing-redo',
            'version',
            'track',
            'type',
            'source',
            'geometry',
            'take-owner',
            'note',
            'controller',
            'pass',
            'expression',
            'take-source',
            'snapshot',
        ])(`refuses the whole serialized ${side} group for %s without changing project truth`, async (corruption) => {
            await recordMixedGesture();
            if (side === 'future') {
                await undo();
            }
            flushAutomergeStorageWrites();
            stampSessionUndoWitness();
            const before = snapshot();
            const mirror = savedMirror();
            expect(mirror[side]).toHaveLength(2);
            corruptRecordingEntry(mirror[side], corruption);
            undoHistoryStore.set({ past: [], future: [] });
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(mirror));
            registerProductionSession();
            expect(undoHistoryStore.value!.past).toEqual([]);
            expect(undoHistoryStore.value!.future).toEqual([]);
            expect(snapshot()).toEqual(before);
        });
    }

    it('keeps older history and untargeted lane members outside the hydrated recording group', async () => {
        await executeAppAction(
            {
                type: 'addClip',
                payload: {
                    id: 'older-midi-clip',
                    trackId: MIDI,
                    startBeat: 0,
                    endBeat: 1,
                    name: 'Earlier clip',
                    type: 'midi',
                },
            },
            { skipUndo: true }
        );
        stageRecordingTake({
            trackId: MIDI,
            clipId: 'older-midi-clip',
            name: 'Untargeted take',
            startBeat: 0,
            endBeat: 1,
        });
        const beforeColor = snapshot();
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: AUDIO, color: '#123456' } });
        const colored = snapshot();
        await recordMixedGesture();
        const recorded = snapshot();
        expect(savedMirror().past).toHaveLength(3);
        undoHistoryStore.set({ past: [], future: [] });
        registerProductionSession();
        for (let cycle = 0; cycle < 2; cycle++) {
            await undo();
            expect(snapshot()).toEqual(colored);
            expect(undoHistoryStore.value!.past).toHaveLength(1);
            await undo();
            expect(snapshot()).toEqual(beforeColor);
            await redo();
            expect(snapshot()).toEqual(colored);
            await redo();
            expect(snapshot()).toEqual(recorded);
        }
    });

    it('retains the existing finite structural MIDI snapshot contract without adding numeric-range policy', async () => {
        await recordMixedGesture();
        const entry = savedMirror().past.find((candidate) => storedClip(candidate).type === 'midi');
        const redo = storedPayload(entry, 'redoAction');
        if (
            !Array.isArray(redo.midiNotesSnapshot) ||
            !isRecord(redo.midiNotesSnapshot[0]) ||
            !Array.isArray(redo.midiCcSnapshot) ||
            !isRecord(redo.midiCcSnapshot[0])
        ) {
            throw new Error('Expected actual MIDI snapshots');
        }
        redo.midiNotesSnapshot[0].duration = -1;
        redo.midiCcSnapshot[0].value = 999;
        expect(isRecordingRestoreSessionPayload(redo)).toBe(true);
        expect(redo.midiNotesSnapshot[0].duration).toBe(-1);
        expect(redo.midiCcSnapshot[0].value).toBe(999);
    });

    it('hydrates the one-beat audio minimum and canonical undefined optional metadata', async () => {
        await recordMixedGesture(true);
        const recorded = snapshot();
        expect(savedMirror().past).toHaveLength(2);
        undoHistoryStore.set({ past: [], future: [] });
        registerProductionSession();
        expect(undoHistoryStore.value!.past).toHaveLength(2);
        await undo();
        expect(trackStore.value!.tracks.flatMap((track) => track.clips)).toEqual([]);
        await redo();
        expect(snapshot()).toEqual(recorded);
    });

    it('retains reachable older history when a malformed future sibling refuses the whole recording group', async () => {
        const original = snapshot();
        await executeAppAction({ type: 'setTrackColor', payload: { trackId: AUDIO, color: '#123456' } });
        await recordMixedGesture();
        await undo();
        flushAutomergeStorageWrites();
        stampSessionUndoWitness();
        const before = snapshot();
        const mirror = savedMirror();
        expect(mirror.past).toHaveLength(1);
        expect(mirror.future).toHaveLength(2);
        corruptRecordingEntry(mirror.future, 'inverse');
        undoHistoryStore.set({ past: [], future: [] });
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(mirror));
        registerProductionSession();
        expect(undoHistoryStore.value!.past).toHaveLength(1);
        expect(undoHistoryStore.value!.future).toEqual([]);
        expect(snapshot()).toEqual(before);
        await undo();
        expect(snapshot()).toEqual(original);
    });
});
