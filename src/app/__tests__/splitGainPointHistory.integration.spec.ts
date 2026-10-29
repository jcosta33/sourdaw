import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    gainEnvelopeStore,
    sampleGainEnvelopeSeries,
    takeLaneStore,
    trackStore,
    warpStateStore,
    type Clip,
    type GainEnvelopePoint,
} from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    executeAppAction,
    productionBriefAdmissionPort,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    setActionHistoryMetadataPort,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import { actionHistoryStore, agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    agentProjectInspectionPort,
    captureDurableDocumentWitness,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    inspectCurrentAgentProjectRepairState,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    projectCrdtToStores,
    recordActionHistoryEntries,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { productionBriefActionBatchAdmission } from '#/modules/Project/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { defaultWorkspaceState, workspaceStore } from '#/modules/WorkspaceShell/stores';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { captureAgentProjectInspectionState } from '../captureCommandBatchPreflightState';

const SESSION_KEY = 'sourdaw-undo-session';
const PROJECT_ID = 'split-gain-history-project';
const LEFT = 'original-audio';
const RIGHT = 'split-audio-right';
const START = 0.3;
const END = 4.7;
const SEAM = 2.1;
const DELTA = SEAM - START;
const AUTHORED: GainEnvelopePoint[] = [
    { id: 'before-window', beatOffset: -0.4, gainDb: -3 },
    { id: 'original-point', beatOffset: 0.2, gainDb: -6 },
    { id: 'before-seam', beatOffset: 1.1, gainDb: -12 },
    { id: 'on-seam', beatOffset: DELTA, gainDb: -4 },
    { id: 'after-seam', beatOffset: 2.8, gainDb: -9 },
    { id: 'after-window', beatOffset: 5.2, gainDb: 2 },
];
type Root = {
    tracks: NonNullable<typeof trackStore.value>;
    gainEnvelopes: NonNullable<typeof gainEnvelopeStore.value>;
    actionHistory: NonNullable<typeof actionHistoryStore.value>;
    otherEntities?: { id: string }[];
};
type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};
let stopProjection: () => void = () => undefined;

function root() {
    const document = getCrdtDoc<Root>('root');
    if (!document) {
        throw new Error('Expected the production project root');
    }
    return document;
}

function owners() {
    return structuredClone({ tracks: trackStore.value!.tracks, gainEnvelopes: gainEnvelopeStore.value });
}

function rawOwners() {
    return structuredClone({ tracks: root().tracks.tracks, gainEnvelopes: root().gainEnvelopes });
}

function registerHandlers(deferSessionRestore = false) {
    clearHandlerRegistry();
    registerProductionCommandHandlers(
        [
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => false }),
            getMidiNoteTransformHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ],
        { deferSessionRestore }
    );
}

function expectValidProject() {
    flushAutomergeStorageWrites();
    expect(countPendingAutomergeStorageWrites()).toBe(0);
    expect(captureAgentProjectInspectionState({ projectDocument: root(), targetIds: [] })).toMatchObject({
        audioGraphValid: true,
        projectInvariantsValid: true,
    });
    expect(inspectCurrentAgentProjectRepairState()).toBeNull();
    projectCrdtToStores({ resetProjections: true });
    expect(agentProjectRepairStateStore.value).toBeNull();
    expect(owners()).toEqual(rawOwners());
}

// An independent reference: bracket by distance, then weight the two endpoint values.
function referenceGain(beat: number) {
    const lower = AUTHORED.findLast((point) => point.beatOffset <= beat) ?? AUTHORED[0]!;
    const upper = AUTHORED.find((point) => point.beatOffset >= beat) ?? AUTHORED.at(-1)!;
    if (lower === upper) {
        return lower.gainDb;
    }
    const width = upper.beatOffset - lower.beatOffset;
    return (lower.gainDb * (upper.beatOffset - beat) + upper.gainDb * (beat - lower.beatOffset)) / width;
}

function expectCurve(clipId: string, offset: number, duration: number) {
    const points = gainEnvelopeStore.value!.envelopes[clipId]!.points;
    const samples = new Set([0, duration, ...Array.from({ length: 41 }, (_, index) => (duration * index) / 40)]);
    for (const point of AUTHORED) {
        const beat = point.beatOffset - offset;
        if (beat >= 0 && beat <= duration) {
            samples.add(beat);
        }
    }
    for (const beat of samples) {
        const actual = sampleGainEnvelopeSeries(points, beat, beat);
        expect(actual).toHaveLength(1);
        expect(actual[0]!.gainDb).toBeCloseTo(referenceGain(beat + offset), 10);
    }
}

function expectSplit() {
    expectValidProject();
    const clips = trackStore.value!.tracks.find((track) => track.id === 'audio-track')!.clips;
    expect(clips.find((clip) => clip.id === LEFT)).toMatchObject({ startBeat: START, endBeat: SEAM, type: 'audio' });
    expect(clips.find((clip) => clip.id === RIGHT)).toMatchObject({ startBeat: SEAM, endBeat: END, type: 'audio' });
    expect(gainEnvelopeStore.value!.envelopes[LEFT]).toEqual({ clipId: LEFT, enabled: true, points: AUTHORED });
    expect(gainEnvelopeStore.value!.envelopes[RIGHT]).toEqual({
        clipId: RIGHT,
        enabled: true,
        points: AUTHORED.map((point) => ({ ...point, beatOffset: point.beatOffset - DELTA })),
    });
    for (const envelope of Object.values(gainEnvelopeStore.value!.envelopes)) {
        expect(new Set(envelope.points.map((point) => point.id)).size).toBe(envelope.points.length);
    }
    expectCurve(LEFT, 0, DELTA);
    expectCurve(RIGHT, DELTA, END - SEAM);
}

async function split() {
    await executeAppAction(
        { type: 'splitClip', payload: { clipId: LEFT, beat: SEAM, rightClipId: RIGHT } },
        { source: 'manual' }
    );
    expectSplit();
    expect(undoHistoryStore.value!.past).toHaveLength(1);
    expect(undoHistoryStore.value!.future).toHaveLength(0);
    expect(actionHistoryStore.value!.entries).toHaveLength(1);
    expect(actionHistoryStore.value!.entries[0]).toMatchObject({ actionKind: 'splitClip', reverted: false });
    expect(root().actionHistory).toEqual(actionHistoryStore.value);
}

async function reloadSavedProject() {
    flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    const history = structuredClone(undoHistoryStore.value!);
    await vi.waitFor(() => {
        const wire: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
        expect(wire).toMatchObject({ past: history.past, future: history.future, projectId: PROJECT_ID });
        expect(countPendingAutomergeStorageWrites()).toBe(0);
    });
    const serialized = sessionStorage.getItem(SESSION_KEY);
    const document = root();
    const saved = Automerge.save(document);
    const loaded = Automerge.load<Root>(saved);
    expect(loaded).toEqual(document);
    expect(Automerge.getHeads(loaded)).toEqual(Automerge.getHeads(document));
    const expectedOwners = owners();
    // Establish a fresh deferred boot, retaining the exact serialized mirror.
    registerHandlers();
    stopProjection();
    removeCrdtDoc('root');
    registerHandlers(true);
    expect(undoHistoryStore.value).toEqual({ past: [], future: [] });
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(serialized);
    replaceCrdtDoc({ id: 'root', doc: loaded });
    projectCrdtToStores({ resetProjections: true });
    stopProjection = setupProjectionBridge();
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
    expect(undoHistoryStore.value).toEqual(history);
    expect(owners()).toEqual(expectedOwners);
    expectValidProject();
}

async function expectUndoRefused() {
    const raw = structuredClone(root());
    const heads = Automerge.getHeads(root());
    const projection = owners();
    const history = structuredClone(undoHistoryStore.value);
    expect((await undo()).headConsumed).toBe(false);
    flushAutomergeStorageWrites();
    expect(root()).toEqual(raw);
    expect(Automerge.getHeads(root())).toEqual(heads);
    expect(owners()).toEqual(projection);
    expect(undoHistoryStore.value).toEqual(history);
}

describe('audio split gain identity with production repair admission and saved history (#5157)', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('split gain combined acceptance');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem(SESSION_KEY);
        setNotificationEventBus(createEventBus<NotificationEvents>());
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            recordBatch: recordActionHistoryEntries,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        agentProjectInspectionPort.setProvider(captureAgentProjectInspectionState);
        productionBriefAdmissionPort.setGuard(productionBriefActionBatchAdmission.capture);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        takeLaneStore.set({ lanes: [] });
        warpStateStore.set({ states: {} });
        automationStore.set({ lanes: [] });
        midiStore.set({ probabilitySeed: 1, notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        actionHistoryStore.set({ entries: [] });
        workspaceStore.set({ ...defaultWorkspaceState, rippleEditing: false });
        const audio: Clip = {
            id: LEFT,
            trackId: 'audio-track',
            name: 'Original audio',
            type: 'audio',
            startBeat: START,
            endBeat: END,
            audioBufferId: 'original-audio-buffer',
            audioOffsetBeats: 0,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ffffff',
            locked: false,
            muted: false,
        };
        const track = createTrack({
            id: 'audio-track',
            initialAlternativeId: 'audio-alternative',
            name: 'Audio',
            kind: 'audio',
        });
        const unrelated = createTrack({
            id: 'unrelated-track',
            initialAlternativeId: 'unrelated-alternative',
            name: 'Unrelated',
            kind: 'audio',
        });
        const master = createTrack({
            id: 'master',
            initialAlternativeId: 'master-alternative',
            name: 'Master',
            kind: 'master',
        });
        trackStore.set({
            tracks: [master, { ...track, clips: [audio] }, unrelated],
            selectedTrackId: track.id,
            ghostClips: [],
        });
        gainEnvelopeStore.set({
            envelopes: { [LEFT]: { clipId: LEFT, enabled: true, points: structuredClone(AUTHORED) } },
        });
        flushAutomergeStorageWrites();
        registerHandlers();
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
        stopProjection = setupProjectionBridge();
        expectValidProject();
    });

    afterEach(() => {
        stopProjection();
        stopProjection = () => undefined;
        clearHandlerRegistry();
        agentProjectInspectionPort.setProvider(null);
        sessionStorage.removeItem(SESSION_KEY);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('preserves rich gain, exact audio owners and real Undo/Redo immediately and after binary/session hydration', async () => {
        const original = owners();
        const originalRaw = rawOwners();
        const unrelated = structuredClone(trackStore.value!.tracks.find((track) => track.id === 'unrelated-track'));
        expectCurve(LEFT, 0, END - START);
        await split();
        const divided = owners();
        const dividedRaw = rawOwners();
        for (const saved of [false, true]) {
            if (saved) {
                await reloadSavedProject();
            }
            expect((await undo()).headConsumed).toBe(true);
            expectValidProject();
            expect(owners()).toEqual(original);
            expect(rawOwners()).toEqual(originalRaw);
            expect(undoHistoryStore.value!.past).toHaveLength(0);
            expect(undoHistoryStore.value!.future).toHaveLength(1);
            expect(root().actionHistory).toEqual(actionHistoryStore.value);
            expect(actionHistoryStore.value!.entries).toHaveLength(1);
            if (saved) {
                await reloadSavedProject();
            }
            await redo();
            expectSplit();
            expect(owners()).toEqual(divided);
            expect(rawOwners()).toEqual(dividedRaw);
            expect(undoHistoryStore.value!.past).toHaveLength(1);
            expect(undoHistoryStore.value!.future).toHaveLength(0);
            expect(trackStore.value!.tracks.find((track) => track.id === 'unrelated-track')).toEqual(unrelated);
        }
        // The left fragment retains the authored material beyond its cut edge.
        await executeAppAction(
            { type: 'trimClipEnd', payload: { clipId: LEFT, newEndBeat: END } },
            { source: 'manual' }
        );
        expectValidProject();
        expectCurve(LEFT, 0, END - START);
        expect(gainEnvelopeStore.value!.envelopes[LEFT]!.points).toEqual(AUTHORED);
        expect((await undo()).headConsumed).toBe(true);
        expectSplit();
        expect(owners()).toEqual(divided);
    });

    it.each(['same-envelope point', 'global non-gain entity'] as const)(
        'requires repair and refuses Undo for a duplicate %s',
        async (duplicate) => {
            await split();
            const projection = owners();
            mutateCrdtDoc<Root>({
                id: 'root',
                changeFn: (document) => {
                    if (duplicate === 'same-envelope point') {
                        document.gainEnvelopes.envelopes[LEFT]!.points[1]!.id = AUTHORED[0]!.id;
                    } else {
                        document.otherEntities = [{ id: 'audio-track' }];
                    }
                },
            });
            expect(inspectCurrentAgentProjectRepairState()).toMatchObject({
                projectInvariantsValid: false,
                status: 'repair-required',
            });
            projectCrdtToStores();
            expect(agentProjectRepairStateStore.value).toMatchObject({
                projectInvariantsValid: false,
                status: 'repair-required',
            });
            expect(owners()).toEqual(projection);
            await expectUndoRefused();
        }
    );

    it('preserves a merged peer gain edit and saved history when Undo conflicts', async () => {
        await split();
        await reloadSavedProject();
        const document = root();
        const peer = Automerge.change(Automerge.clone(document), (draft) => {
            draft.gainEnvelopes.envelopes[RIGHT]!.points[1]!.gainDb = -21;
        });
        expect(Automerge.getActorId(peer)).not.toBe(Automerge.getActorId(document));
        const merged = Automerge.merge(Automerge.clone(document), peer);
        replaceCrdtDocInLineage({ id: 'root', doc: merged });
        projectCrdtToStores();
        expectValidProject();
        expect(root().gainEnvelopes.envelopes[RIGHT]!.points[1]!.gainDb).toBe(-21);
        expect(gainEnvelopeStore.value!.envelopes[RIGHT]!.points[1]!.gainDb).toBe(-21);
        await expectUndoRefused();
    });
});
