import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    getAutomationHandlers,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    startAutomationRecording,
    stopAutomationRecording,
} from '#/modules/Automation/useCases';
import {
    captureDurableDocumentWitness,
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getMidiGrooveHandlers, getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type AppAction, type HandlerSessionActionEntry } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { clearHandlerRegistry, getHandlerByType, registerHandlerMap } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { reconcileSessionUndoForProject } from '../reconcileSessionUndoForProject';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { stampSessionUndoWitness } from '../stampSessionUndoWitness';
import { undo } from '../undo';

/**
 * A recorded automation pass, a new automation lane and an automation transform each keep their undo
 * entry, and every older entry behind it, in the session history a project reload restores (#6501).
 */

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const PROJECT_ID = 'automation-session-undo-project';
const TRACK_ID = 'track-vocal';
const LANE_ID = 'lane-vocal-gain';

// Unequal spacing and values so every transform below moves at least one point: 0 → 4.5 → 9 is a
// straight run thinning drops the middle of, 4.5 and 12.25 sit off a one-beat grid.
const LANE_POINTS = [
    { id: 'point-a', beat: 0, value: 0.2, curve: 'linear', tension: 0 },
    { id: 'point-b', beat: 4.5, value: 0.4, curve: 'linear', tension: 0 },
    { id: 'point-c', beat: 9, value: 0.6, curve: 'linear', tension: 0 },
    { id: 'point-d', beat: 12.25, value: 0.1, curve: 'linear', tension: 0 },
] as const;

function gainLane() {
    return {
        id: LANE_ID,
        trackId: TRACK_ID,
        parameterId: 'gain',
        parameterName: 'Gain',
        points: structuredClone([...LANE_POINTS]),
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
}

function primeProject(withLane: boolean): void {
    const track = {
        ...createTrack({ name: 'Lead Vocal', kind: 'audio', withoutDefaultDevice: true }),
        id: TRACK_ID,
        automationMode: 'write' as const,
    };
    trackStore.set({ tracks: [track], selectedTrackId: null });
    automationStore.set({ lanes: withLane ? [gainLane()] : [] });
    transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120, playheadPosition: 1 });
}

/** The handler set a boot registers; deferred, the saved history waits for its project to be installed. */
function registerProduction(deferSessionRestore = false): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(
        [
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getMidiGrooveHandlers(),
            getProjectHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ],
        { deferSessionRestore }
    );
}

function reconcile(): void {
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

type SavedHistory = { past: unknown[]; future: unknown[] };

function isSavedHistory(value: unknown): value is SavedHistory {
    return isRecord(value) && Array.isArray(value.past) && Array.isArray(value.future);
}

/**
 * A project reload: the saved document and the saved session history come back into a fresh boot,
 * which restores the history once the project it was written against is installed. `rewrite` stands
 * in for a history another build or a peer saved.
 */
function reloadSavedProject(rewrite?: (saved: SavedHistory) => SavedHistory): SavedHistory {
    flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    const savedHistory: unknown = JSON.parse(sessionStorage.getItem(UNDO_SESSION_KEY) ?? 'null');
    if (!isSavedHistory(savedHistory)) {
        throw new Error('Expected a saved undo history');
    }
    const restoredHistory = rewrite ? rewrite(savedHistory) : savedHistory;
    sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(restoredHistory));
    const current = getCrdtDoc('root');
    if (!current) {
        throw new Error('Expected a project to save');
    }
    const saved = Automerge.save(current);
    removeCrdtDoc('root');
    registerProduction(true);
    expect(undoStore.value).toMatchObject({ past: [], future: [] });
    replaceCrdtDoc({ id: 'root', doc: Automerge.load(saved) });
    projectCrdtToStores({ resetProjections: true });
    reconcile();
    return savedHistory;
}

function savedTypes(entries: readonly unknown[]): string[] {
    return entries.map((entry) => {
        const action = isRecord(entry) ? entry.action : undefined;
        return isRecord(action) && typeof action.type === 'string' ? action.type : 'unknown';
    });
}

function pastTypes(): string[] {
    return (undoStore.value?.past ?? []).map((entry) => (entry.kind === 'action' ? entry.action.type : entry.kind));
}

function lanes(): unknown {
    return structuredClone(automationStore.value?.lanes);
}

function vocalColor(): string | undefined {
    return trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.color;
}

async function recolorVocal(color: string): Promise<void> {
    await executeAppAction({ type: 'setTrackColor', payload: { trackId: TRACK_ID, color } });
    expect(vocalColor()).toBe(color);
}

/** One write pass over the gain lane, committed at the transport stop on beat 8. */
function recordPass(): void {
    startAutomationRecording();
    recordAutomationValue(TRACK_ID, 'gain', 0.8, 2);
    recordAutomationValue(TRACK_ID, 'gain', 0.3, 3);
    recordAutomationValue(TRACK_ID, 'gain', 0.9, 4);
    stopAutomationRecording(8);
}

async function addGainLane(): Promise<void> {
    await executeAppAction({
        type: 'addAutomationLane',
        payload: { trackId: TRACK_ID, parameterId: 'gain', parameterName: 'Gain', laneId: LANE_ID },
    });
}

const TRANSFORMS = [
    { type: 'reverseAutomation', payload: { laneId: LANE_ID } },
    { type: 'invertAutomation', payload: { laneId: LANE_ID } },
    { type: 'scaleAutomation', payload: { laneId: LANE_ID, factor: 0.5, anchor: 0 } },
    { type: 'stretchAutomation', payload: { laneId: LANE_ID, factor: 2, anchorBeat: 0 } },
    { type: 'thinAutomation', payload: { laneId: LANE_ID, tolerance: 0.001 } },
    { type: 'quantizeAutomation', payload: { laneId: LANE_ID, gridSize: 1 } },
] as const satisfies readonly AppAction[];

type EntryKind = {
    readonly kind: string;
    readonly withLane: boolean;
    readonly write: () => Promise<void> | void;
    readonly forward: AppAction['type'];
};

const ENTRY_KINDS: readonly EntryKind[] = [
    { kind: 'recorded automation pass', withLane: true, write: recordPass, forward: 'restoreAutomationLanePoints' },
    { kind: 'new automation lane', withLane: false, write: addGainLane, forward: 'addAutomationLane' },
    ...TRANSFORMS.map((transform) => ({
        kind: `${transform.type} transform`,
        withLane: true,
        write: async () => {
            await executeAppAction(structuredClone(transform));
        },
        forward: transform.type,
    })),
];

describe('automation undo entries in the history a project reload restores', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('automation session undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        clearUndoHistory();
        registerProduction();
        const context = new AudioContext({ sampleRate: 48_000 });
        Object.defineProperties(context, { baseLatency: { value: 0 }, outputLatency: { value: 0 } });
        setAutomationRecordingDependencies({ getAudioContext: () => context, getCompensationDelay: () => 0 });
    });

    afterEach(() => {
        stopAutomationRecording();
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    function prime(withLane: boolean): void {
        primeProject(withLane);
        flushAutomergeStorageWrites();
        reconcile();
    }

    it.each(ENTRY_KINDS)(
        'restores, undoes and redoes a $kind behind an older edit',
        async ({ withLane, write, forward }) => {
            prime(withLane);
            const originalColor = vocalColor();
            await recolorVocal('#ff5500');
            const before = lanes();
            await write();
            const written = lanes();
            expect(written).not.toEqual(before);

            const savedHistory = reloadSavedProject();

            expect(savedTypes(savedHistory.past)).toEqual(['setTrackColor', forward]);
            expect(pastTypes()).toEqual(['setTrackColor', forward]);
            expect(lanes()).toEqual(written);

            await undo();
            expect(lanes()).toEqual(before);
            expect(vocalColor()).toBe('#ff5500');
            await redo();
            expect(lanes()).toEqual(written);
            await undo();
            expect(lanes()).toEqual(before);

            await undo();
            expect(vocalColor()).toBe(originalColor);
            expect(pastTypes()).toEqual([]);
        }
    );

    /** The saved history with the inverse of its `index`th entry rewritten as another build or a peer might. */
    function withSavedInverse(
        index: number,
        rewrite: (inverse: Record<string, unknown>, payload: Record<string, unknown>) => void
    ): (saved: SavedHistory) => SavedHistory {
        return (saved) => {
            const past = structuredClone(saved.past);
            const entry = past[index];
            const inverse = isRecord(entry) ? entry.inverseAction : undefined;
            if (!isRecord(inverse) || !isRecord(inverse.payload)) {
                throw new Error(`Expected saved entry ${String(index)} to carry an inverse`);
            }
            rewrite(inverse, inverse.payload);
            return { ...saved, past };
        };
    }

    it.each(ENTRY_KINDS)(
        'drops a saved $kind whose undo names another lane, with everything older',
        async ({ withLane, write, forward }) => {
            prime(withLane);
            await recolorVocal('#ff5500');
            await write();
            await recolorVocal('#0000ff');
            const written = lanes();

            const savedHistory = reloadSavedProject(
                withSavedInverse(1, (_inverse, payload) => {
                    payload.laneId = 'lane-someone-else';
                })
            );

            expect(savedTypes(savedHistory.past)).toEqual(['setTrackColor', forward, 'setTrackColor']);
            // The mirror keeps only the unbroken run nearest the present, so the refused entry strands
            // every entry older than it.
            expect(pastTypes()).toEqual(['setTrackColor']);
            await undo();
            expect(vocalColor()).toBe('#ff5500');
            expect(lanes()).toEqual(written);
            expect(pastTypes()).toEqual([]);
        }
    );
});

const POINT = { id: 'point-a', beat: 0, value: 0.2, curve: 'linear', tension: 0 } as const;
const LATER_POINT = { id: 'point-b', beat: 4, value: 0.6, curve: 'linear', tension: 0 } as const;
const RECORDED_POINT = { beat: 2, value: 0.8, curve: 'linear', tension: 0 } as const;

function entryValidator(actionType: AppAction['type']): (entry: HandlerSessionActionEntry) => boolean {
    const validateSessionEntry = getHandlerByType(actionType)?.validateSessionEntry;
    if (!validateSessionEntry) {
        throw new Error(`Expected ${actionType} to validate its saved entries`);
    }
    return validateSessionEntry;
}

function expectRefusals(
    validate: (entry: HandlerSessionActionEntry) => boolean,
    refused: Record<string, HandlerSessionActionEntry>
): void {
    for (const [reason, entry] of Object.entries(refused)) {
        expect(validate(entry), reason).toBe(false);
    }
}

describe('the saved-history contracts of automation undo entries', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getAutomationHandlers());
    });

    afterEach(() => {
        clearHandlerRegistry();
    });

    it('keeps a saved recorded pass only when its undo restores exactly what the pass replaced', () => {
        const validate = entryValidator('restoreAutomationLanePoints');
        const before = [POINT, LATER_POINT];
        const after = [POINT, RECORDED_POINT, LATER_POINT];
        const action = {
            type: 'restoreAutomationLanePoints',
            payload: { laneId: LANE_ID, points: after, expectedPoints: before },
        } satisfies AppAction;
        const inverseAction = {
            type: 'restoreAutomationLanePoints',
            payload: { laneId: LANE_ID, points: before, expectedPoints: after },
        } satisfies AppAction;

        expect(validate({ action, inverseAction })).toBe(true);
        expectRefusals(validate, {
            'no undo': { action, inverseAction: null },
            'an undo of another type': {
                action,
                inverseAction: { type: 'removeAutomationLane', payload: { laneId: LANE_ID } },
            },
            'an undo naming another lane': {
                action,
                inverseAction: { ...inverseAction, payload: { ...inverseAction.payload, laneId: 'lane-other' } },
            },
            'an undo restoring points the pass did not replace': {
                action,
                inverseAction: { ...inverseAction, payload: { ...inverseAction.payload, points: [POINT] } },
            },
            'an undo expecting points the pass did not write': {
                action,
                inverseAction: { ...inverseAction, payload: { ...inverseAction.payload, expectedPoints: before } },
            },
            'an undo without expected points': {
                action,
                inverseAction: { ...inverseAction, payload: { laneId: LANE_ID, points: before } },
            },
            'a pass without expected points': {
                action: { ...action, payload: { laneId: LANE_ID, points: after } },
                inverseAction,
            },
            'a pass that changed nothing': {
                action: { ...action, payload: { ...action.payload, points: before } },
                inverseAction: { ...inverseAction, payload: { ...inverseAction.payload, expectedPoints: before } },
            },
            'a pass with points out of beat order': {
                action: { ...action, payload: { ...action.payload, points: [LATER_POINT, POINT] } },
                inverseAction: {
                    ...inverseAction,
                    payload: { ...inverseAction.payload, expectedPoints: [LATER_POINT, POINT] },
                },
            },
            'a redo': { action, inverseAction, redoAction: action },
        });
    });

    it('keeps a saved new lane only when its undo removes exactly that lane', () => {
        const validate = entryValidator('addAutomationLane');
        const action = {
            type: 'addAutomationLane',
            payload: { trackId: TRACK_ID, parameterId: 'gain', parameterName: 'Gain', laneId: LANE_ID },
        } satisfies AppAction;
        const inverseAction = { type: 'removeAutomationLane', payload: { laneId: LANE_ID } } satisfies AppAction;

        expect(validate({ action, inverseAction })).toBe(true);
        expect(validate({ action, inverseAction: null })).toBe(true);
        expectRefusals(validate, {
            'an undo of another type': {
                action,
                inverseAction: { type: 'restoreAutomationLanePoints', payload: { laneId: LANE_ID, points: [] } },
            },
            'an undo naming another lane': {
                action,
                inverseAction: { ...inverseAction, payload: { laneId: 'other' } },
            },
            'an undo expecting points the new lane never held': {
                action,
                inverseAction: { ...inverseAction, payload: { laneId: LANE_ID, expectedPoints: [POINT] } },
            },
            'a lane without its id': {
                action: { ...action, payload: { trackId: TRACK_ID, parameterId: 'gain', parameterName: 'Gain' } },
                inverseAction,
            },
            'a redo': { action, inverseAction, redoAction: action },
            'a redo without an undo': { action, inverseAction: null, redoAction: action },
        });
    });

    it.each(TRANSFORMS)('keeps a saved $type only when its undo restores that lane', (transform) => {
        const validate = entryValidator(transform.type);
        const action = structuredClone(transform);
        const inverseAction = {
            type: 'restoreAutomationLanePoints',
            payload: { laneId: LANE_ID, points: [POINT, LATER_POINT], expectedPoints: [LATER_POINT] },
        } satisfies AppAction;

        expect(validate({ action, inverseAction })).toBe(true);
        expect(validate({ action, inverseAction: null })).toBe(true);
        expectRefusals(validate, {
            'an undo of another type': {
                action,
                inverseAction: { type: 'removeAutomationLane', payload: { laneId: LANE_ID } },
            },
            'an undo naming another lane': {
                action,
                inverseAction: { ...inverseAction, payload: { ...inverseAction.payload, laneId: 'other' } },
            },
            'an undo without expected points': {
                action,
                inverseAction: { ...inverseAction, payload: { laneId: LANE_ID, points: [POINT] } },
            },
            'an undo restoring points out of beat order': {
                action,
                inverseAction: {
                    ...inverseAction,
                    payload: { ...inverseAction.payload, points: [LATER_POINT, POINT] },
                },
            },
            'a redo': { action, inverseAction, redoAction: action },
        });
    });
});
