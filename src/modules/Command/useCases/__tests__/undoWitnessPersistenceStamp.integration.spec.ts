import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import {
    installTransactionalIndexedDb,
    type TransactionalIndexedDbInstallation,
} from '#/infra/testing/installTransactionalIndexedDb';
import { takeLaneStore, type TakeLaneStoreState } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, selectTake } from '#/modules/Arrangement/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    captureDurableDocumentWitness,
    clearActionHistory as clearCrdtActionHistory,
    compactProject,
    createCrdtDoc,
    hasCrdtDoc,
    getCrdtDoc,
    loadCrdtProject,
    markActionHistoryEntryReverted,
    persistCrdtProject,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    sessionUndoWitnessStampPort,
} from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { hydrateUndoStoreFromSession, undoStore } from '../../stores/undoStore';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { getExecutableCommandRegistration } from '../getExecutableCommandRegistration';
import { reconcileSessionUndoForProject } from '../reconcileSessionUndoForProject';
import { redo } from '../redo';
import { stampSessionUndoWitness } from '../stampSessionUndoWitness';
import { undo } from '../undo';
import { validateVersionedCommandArguments } from '../versionedCommandArgumentKeys';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const PROJECT_ID = 'project-e1';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const sessionActionContracts = [
    {
        actionType: 'setTempo',
        operationVersion: 1,
        role: 'forward' as const,
        validateArguments: (payload: unknown) => validateVersionedCommandArguments('setTempo', payload),
    },
];

function hydrateSelectTakeUndoSession(): void {
    const registration = getExecutableCommandRegistration('selectTake');
    hydrateUndoStoreFromSession([
        {
            actionType: registration.actionType,
            operationVersion: registration.operationVersion,
            role: 'forward',
            validateArguments: registration.runtimeSchema.validate,
            validateEntry: registration.sessionEntryValidator,
        },
    ]);
}

function selectedTakeId(lane: TakeLaneStoreState['lanes'][number]): string | null {
    return lane.takes.find((take) => take.selected)?.id ?? null;
}

function projectedTakeLane(): TakeLaneStoreState['lanes'][number] {
    const lane = takeLaneStore.value?.lanes.find((candidate) => candidate.trackId === 'track-1');
    if (!lane) {
        throw new Error('Expected projected take lane');
    }
    return lane;
}

function rawTakeLane(): TakeLaneStoreState['lanes'][number] {
    const lane = getCrdtDoc<{ takeLanes?: TakeLaneStoreState }>('root')?.takeLanes?.lanes.find(
        (candidate) => candidate.trackId === 'track-1'
    );
    if (!lane) {
        throw new Error('Expected raw take lane');
    }
    return lane;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readMirroredWitness(): string | undefined {
    const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
    if (raw === null) {
        return undefined;
    }
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && typeof parsed.witness === 'string' ? parsed.witness : undefined;
}

async function flushPendingFrame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function flushPendingMicrotask(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}

describe('Command undo witness persistence stamp integration (#3331)', () => {
    let unsubscribeActionHistory: (() => void) | null = null;
    let indexedDb: TransactionalIndexedDbInstallation | null = null;

    beforeAll(() => {
        indexedDb = installTransactionalIndexedDb();
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        await compactProject();
        clearCrdtActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearCrdtActionHistory,
        });
        // Wires the real production stamp, exactly as `src/app/bootstrap.ts`
        // does, so this spec drives the actual port a deleted or unwired
        // bootstrap line would leave unstamped.
        sessionUndoWitnessStampPort.setProvider(stampSessionUndoWitness);
        unsubscribeActionHistory = actionHistoryStore.subscribe(() => undefined);
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem(UNDO_SESSION_KEY);

        const setTempoHandler: ActionHandler<SetTempoAction> = {
            undoable: true,
            execute: () => undefined,
            describe: (action) => ({
                label: 'Set tempo',
                inverseAction: { type: 'setTempo', payload: { bpm: action.payload.bpm - 10 } },
            }),
        };
        registerHandlerMap({ setTempo: setTempoHandler });
    });

    afterEach(async () => {
        unsubscribeActionHistory?.();
        unsubscribeActionHistory = null;
        clearHandlerRegistry();
        clearUndoHistory();
        clearCrdtActionHistory();
        await flushPendingFrame();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        sessionUndoWitnessStampPort.setProvider(null);
        removeCrdtDoc('root');
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        vi.restoreAllMocks();
    });

    afterAll(async () => {
        await indexedDb?.dispose();
        indexedDb = null;
    });

    it('re-witnesses the mirror against the document state a persistence step actually saves, so a reload keeps the stacks', async () => {
        // Establishes the executable action set the mirror hydrates/persists
        // against, and (since sessionStorage is empty here) hydrates to no
        // owner — matching a fresh boot with no prior mirror.
        hydrateUndoStoreFromSession(sessionActionContracts);
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });

        await executeAppAction({ type: 'setTempo', payload: { bpm: 130 } });

        // The undo store's own microtask flush races the action-history
        // entry's rAF-deferred CRDT write (executeAppAction fires it, then
        // synchronously commits the undo entry, before that frame runs) — the
        // witness it captures can be stale relative to what later becomes
        // durable. Assert that race is live here rather than assumed.
        await flushPendingMicrotask();
        const witnessBeforeFrame = captureDurableDocumentWitness();
        const staleMirroredWitness = readMirroredWitness();
        expect(staleMirroredWitness).toBe(witnessBeforeFrame);

        await flushPendingFrame();
        const witnessAfterFrame = captureDurableDocumentWitness();
        expect(witnessAfterFrame).not.toBe(witnessBeforeFrame);
        // The microtask flush already ran and is not re-triggered by the
        // frame landing, so the mirror is still stale until something
        // re-witnesses it.
        expect(readMirroredWitness()).toBe(staleMirroredWitness);

        // The real production persistence step flushes the generation,
        // commits the bytes through IndexedDB, and stamps the witness through
        // the production port before returning.
        await persistCrdtProject();

        expect(readMirroredWitness()).toBe(witnessAfterFrame);

        // Drop the live root, then use the public lifecycle to install the
        // bytes the persistence step actually committed. Reconciliation below
        // therefore cannot compare the session mirror to the untouched root.
        removeCrdtDoc('root');
        expect(hasCrdtDoc('root')).toBe(false);
        createCrdtDoc('root');
        await expect(loadCrdtProject()).resolves.toBe(true);
        expect(captureDurableDocumentWitness()).toBe(witnessAfterFrame);

        // Simulate the next boot: hydrate from the mirror the stamp just
        // wrote, then reconcile against the reloaded document witness.
        hydrateUndoStoreFromSession(sessionActionContracts);
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });

        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]).toMatchObject({ label: 'Set tempo' });
    });

    it('persists and reloads a real take-selection inverse before undo and redo', async () => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        hydrateSelectTakeUndoSession();
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
        const lane: TakeLaneStoreState['lanes'][number] = {
            id: 'lane-1',
            trackId: 'track-1',
            takes: [
                {
                    id: 'take-a',
                    clipId: 'clip-a',
                    name: 'Take A',
                    startBeat: 0,
                    endBeat: 4,
                    selected: false,
                },
                {
                    id: 'take-b',
                    clipId: 'clip-b',
                    name: 'Take B',
                    startBeat: 4,
                    endBeat: 8,
                    selected: false,
                },
            ],
            activeCompRegions: [],
        };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await selectTake('track-1', 'take-a');
        expect(selectedTakeId(rawTakeLane())).toBe('take-a');
        expect(selectedTakeId(projectedTakeLane())).toBe('take-a');
        expect(undoStore.value).toMatchObject({ past: [expect.any(Object)], future: [] });
        const liveEntryBeforeReload = undoStore.value!.past[0]!;
        await vi.waitFor(() => {
            expect(sessionStorage.getItem(UNDO_SESSION_KEY)).toContain('expectedLaneId');
        });

        await persistCrdtProject();
        const persistedWitness = captureDurableDocumentWitness();
        removeCrdtDoc('root');
        expect(hasCrdtDoc('root')).toBe(false);
        createCrdtDoc('root');
        await expect(loadCrdtProject()).resolves.toBe(true);
        projectCrdtToStores({ resetProjections: true });
        expect(captureDurableDocumentWitness()).toBe(persistedWitness);
        expect(selectedTakeId(rawTakeLane())).toBe('take-a');
        expect(selectedTakeId(projectedTakeLane())).toBe('take-a');

        hydrateSelectTakeUndoSession();
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]).not.toBe(liveEntryBeforeReload);
        expect(undoStore.value?.past[0]).toMatchObject({
            label: 'Select take',
            inverseAction: {
                type: 'selectTake',
                payload: {
                    trackId: 'track-1',
                    takeId: null,
                    expectedLaneId: 'lane-1',
                    expectedSelectedTakeId: 'take-a',
                },
            },
        });

        await expect(undo()).resolves.toEqual({ headConsumed: true });
        expect(selectedTakeId(rawTakeLane())).toBeNull();
        expect(selectedTakeId(projectedTakeLane())).toBeNull();
        expect(undoStore.value).toMatchObject({ past: [], future: [expect.any(Object)] });

        await redo();
        expect(selectedTakeId(rawTakeLane())).toBe('take-a');
        expect(selectedTakeId(projectedTakeLane())).toBe('take-a');
        expect(undoStore.value).toMatchObject({ past: [expect.any(Object)], future: [] });
    });

    it('rejects a persisted take-selection entry whose replay owner relationships disagree', async () => {
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        hydrateSelectTakeUndoSession();
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
        projectCrdtToStores({ resetProjections: true });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-1',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take-a',
                            clipId: 'clip-a',
                            name: 'Take A',
                            startBeat: 0,
                            endBeat: 4,
                            selected: false,
                        },
                    ],
                    activeCompRegions: [],
                },
            ],
        });
        flushAutomergeStorageWrites();

        await selectTake('track-1', 'take-a');
        await vi.waitFor(() => {
            expect(sessionStorage.getItem(UNDO_SESSION_KEY)).toContain('expectedLaneId');
        });
        await persistCrdtProject();
        const persistedWitness = captureDurableDocumentWitness();

        const rawMirror = sessionStorage.getItem(UNDO_SESSION_KEY);
        const mirror: unknown = rawMirror === null ? null : JSON.parse(rawMirror);
        if (!isRecord(mirror) || !Array.isArray(mirror.past) || !isRecord(mirror.past[0])) {
            throw new Error('Expected a persisted select-take undo entry');
        }
        expect(mirror.projectId).toBe(PROJECT_ID);
        expect(mirror.witness).toBe(persistedWitness);
        const entry = mirror.past[0];
        if (
            !isRecord(entry.action) ||
            !isRecord(entry.action.payload) ||
            !isRecord(entry.inverseAction) ||
            !isRecord(entry.inverseAction.payload) ||
            !isRecord(entry.redoAction) ||
            !isRecord(entry.redoAction.payload)
        ) {
            throw new Error('Expected persisted select-take action payloads');
        }
        entry.redoAction.payload.expectedLaneId = 'different-lane-owner';
        const registration = getExecutableCommandRegistration('selectTake');
        expect(entry.actionOperationVersion).toBe(registration.operationVersion);
        expect(entry.inverseActionOperationVersion).toBe(registration.operationVersion);
        expect(entry.redoActionOperationVersion).toBe(registration.operationVersion);
        expect(registration.runtimeSchema.validate(entry.action.payload)).toBe(true);
        expect(registration.runtimeSchema.validate(entry.inverseAction.payload)).toBe(true);
        expect(registration.runtimeSchema.validate(entry.redoAction.payload)).toBe(true);
        sessionStorage.setItem(UNDO_SESSION_KEY, JSON.stringify(mirror));

        removeCrdtDoc('root');
        createCrdtDoc('root');
        await expect(loadCrdtProject()).resolves.toBe(true);
        projectCrdtToStores({ resetProjections: true });
        expect(captureDurableDocumentWitness()).toBe(persistedWitness);
        hydrateSelectTakeUndoSession();
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });

        expect(selectedTakeId(rawTakeLane())).toBe('take-a');
        expect(selectedTakeId(projectedTakeLane())).toBe('take-a');
        expect(undoStore.value).toMatchObject({ past: [], future: [] });
    });
});
