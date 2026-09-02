import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';
import {
    captureDurableDocumentWitness,
    clearActionHistory as clearCrdtActionHistory,
    createCrdtDoc,
    markActionHistoryEntryReverted,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
} from '#/modules/CrdtDocument/useCases';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { hydrateUndoStoreFromSession, undoStore } from '../../stores/undoStore';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { reconcileSessionUndoForProject } from '../reconcileSessionUndoForProject';
import { stampSessionUndoWitness } from '../stampSessionUndoWitness';
import { validateVersionedCommandArguments } from '../versionedCommandArgumentKeys';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const PROJECT_ID = 'project-e1';

const no_action_history_metadata_port = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const session_action_contracts = [
    {
        actionType: 'setTempo',
        operationVersion: 1,
        validateArguments: (payload: unknown) => validateVersionedCommandArguments('setTempo', payload),
    },
];

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

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function flush_pending_microtask(): Promise<void> {
    return new Promise((resolve) => queueMicrotask(resolve));
}

describe('Command undo witness persistence stamp integration (#3331-repair-2, E1)', () => {
    let unsubscribe_action_history: (() => void) | null = null;

    beforeEach(() => {
        vi.clearAllMocks();
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearCrdtActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearCrdtActionHistory,
        });
        unsubscribe_action_history = actionHistoryStore.subscribe(() => undefined);
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem(UNDO_SESSION_KEY);

        const set_tempo_handler: ActionHandler<SetTempoAction> = {
            undoable: true,
            execute: () => undefined,
            describe: (action) => ({
                label: 'Set tempo',
                inverseAction: { type: 'setTempo', payload: { bpm: action.payload.bpm - 10 } },
            }),
        };
        registerHandlerMap({ setTempo: set_tempo_handler });
    });

    afterEach(async () => {
        unsubscribe_action_history?.();
        unsubscribe_action_history = null;
        clearHandlerRegistry();
        clearUndoHistory();
        clearCrdtActionHistory();
        await flush_pending_frame();
        setActionHistoryMetadataPort(no_action_history_metadata_port);
        removeCrdtDoc('root');
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        vi.restoreAllMocks();
    });

    it('re-witnesses the mirror against the document state a persistence step actually saves, so a reload keeps the stacks', async () => {
        // Establishes the executable action set the mirror hydrates/persists
        // against, and (since sessionStorage is empty here) hydrates to no
        // owner — matching a fresh boot with no prior mirror.
        hydrateUndoStoreFromSession(session_action_contracts);
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });

        await executeAppAction({ type: 'setTempo', payload: { bpm: 130 } });

        // The undo store's own microtask flush races the action-history
        // entry's rAF-deferred CRDT write (executeAppAction fires it, then
        // synchronously commits the undo entry, before that frame runs) — the
        // witness it captures can be stale relative to what later becomes
        // durable. Assert that race is live here rather than assumed.
        await flush_pending_microtask();
        const witnessBeforeFrame = captureDurableDocumentWitness();
        const staleMirroredWitness = readMirroredWitness();
        expect(staleMirroredWitness).toBe(witnessBeforeFrame);

        await flush_pending_frame();
        const witnessAfterFrame = captureDurableDocumentWitness();
        expect(witnessAfterFrame).not.toBe(witnessBeforeFrame);
        // The microtask flush already ran and is not re-triggered by the
        // frame landing, so the mirror is still stale until something
        // re-witnesses it.
        expect(readMirroredWitness()).toBe(staleMirroredWitness);

        // The persistence step: force this generation's deferred writes to
        // land (a no-op here since the frame already landed them, exactly
        // like the debounced-incremental and compact paths force it before
        // reading bytes regardless of timing), then re-witness the mirror
        // against that settled state.
        flushAutomergeStorageWrites();
        stampSessionUndoWitness();

        expect(readMirroredWitness()).toBe(witnessAfterFrame);

        // Simulate the next boot: hydrate from the mirror the stamp just
        // wrote, then reconcile against the same project id and the real
        // capture — the stacks must be kept, not cleared.
        hydrateUndoStoreFromSession(session_action_contracts);
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });

        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.past[0]).toMatchObject({ label: 'Set tempo' });
    });
});
