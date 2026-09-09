import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import { executeAppAction, registerProductionCommandHandlers } from '#/modules/Command/useCases';

import { setActiveYeastDevice, yeastStore } from '../../stores/yeastStore';

// The session mirror round trip for a coalesced Yeast gesture (#2111): the
// group's entries persist to sessionStorage, a fresh module graph rehydrates
// them (proving the generated argument schemas accept the guarded forward,
// inverse and redo payloads), and the rehydrated inverses still re-execute
// against live rack state.

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const DEVICE_ID = 'device-mirror';

type RootDocument = { yeast?: unknown };

async function flushPersistence(): Promise<void> {
    await new Promise((resolve) => queueMicrotask(resolve));
    await new Promise((resolve) => queueMicrotask(resolve));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configureInMemoryPort(getDocument: () => Doc<RootDocument>, setDocument: (doc: Doc<RootDocument>) => void) {
    configureAutomergeStoragePort({
        getDoc: getDocument,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            setDocument(change(getDocument(), (draft) => changeFn(draft as unknown as Record<string, unknown>)));
        },
    });
}

describe('Yeast undo session mirror (#2111)', () => {
    let document: Doc<RootDocument>;

    beforeEach(() => {
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        undoHistoryStore.set({ past: [], future: [] });
        document = from({});
        configureInMemoryPort(
            () => document,
            (doc) => {
                document = doc;
            }
        );
        yeastStore.hydrate();
        setActiveYeastDevice(DEVICE_ID);
        yeastStore.set({
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Arp', bypassed: false, params: { gate: 0.8 } }],
            uiLevel: 3,
        });

        // Boot registration: handlers plus the session contracts that let the
        // mirror persist Yeast entries at all.
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    });

    afterEach(async () => {
        await flushPersistence();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActiveYeastDevice(null);
        clearHandlerRegistry();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('persists a coalesced gesture, rehydrates it in a fresh graph, and re-executes its inverses', async () => {
        // One gesture: a drag settle plus a follow-up tweak within the window.
        await executeAppAction({
            type: 'setYeastProcessorParam',
            payload: { processorId: 'arp-1', paramId: 'gate', value: 1.0, expectedValue: 0.8 },
        });
        await executeAppAction(
            {
                type: 'setYeastProcessorParam',
                payload: { processorId: 'arp-1', paramId: 'gate', value: 1.2, expectedValue: 1.0 },
            },
            { coalesceWithPrevious: true }
        );
        expect(yeastStore.value?.processors[0]?.params?.gate).toBe(1.2);

        await flushPersistence();

        // The mirror carries both entries with their shared group and guarded
        // inverse/redo payloads.
        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        expect(raw).not.toBeNull();
        const persisted: unknown = JSON.parse(raw!);
        expect(isRecord(persisted) && Array.isArray(persisted.past)).toBe(true);
        const past = (persisted as { past: unknown[] }).past;
        expect(past).toHaveLength(2);
        const groupIds = new Set(past.map((entry) => (isRecord(entry) ? entry.groupId : undefined)));
        expect(groupIds.size).toBe(1);
        for (const entry of past) {
            expect(isRecord(entry)).toBe(true);
            for (const key of ['action', 'inverseAction', 'redoAction'] as const) {
                const replayed = entry[key];
                if (replayed === null || replayed === undefined) {
                    // Both entries of this gesture carry a redo action.
                    expect(key).not.toBe('redoAction');
                }
            }
        }

        // A fresh module graph — the reopen. Production registration arms the
        // handlers AND the session contracts; the mirror rehydrates only what
        // the current argument contracts accept, so two surviving entries
        // prove the guarded forward, inverse and redo payloads all validate.
        vi.resetModules();
        const { getProductionCommandHandlerMaps: freshMaps } = await import('#/app/getProductionCommandHandlerMaps');
        const { registerProductionCommandHandlers: freshRegisterProduction } =
            await import('#/modules/Command/useCases');
        const { undoHistoryStore: freshUndoHistoryStore } = await import('#/modules/Command/stores');
        const { setActiveYeastDevice: freshPin, yeastStore: freshYeastStore } = await import('../../stores/yeastStore');
        const { undo: freshUndo } = await import('#/modules/Command/useCases');

        document = from({});
        configureInMemoryPort(
            () => document,
            (doc) => {
                document = doc;
            }
        );
        freshYeastStore.hydrate();
        freshPin(DEVICE_ID);
        // The reopened project carries the post-gesture rack state.
        freshYeastStore.set({
            processors: [{ id: 'arp-1', type: 'arpeggiator', name: 'Arp', bypassed: false, params: { gate: 1.2 } }],
            uiLevel: 3,
        });
        freshRegisterProduction(freshMaps({ canMutateBranchMetadata: () => true }));

        const rehydrated = freshUndoHistoryStore.value?.past ?? [];
        expect(rehydrated).toHaveLength(2);
        expect(new Set(rehydrated.map((entry) => entry.groupId)).size).toBe(1);
        for (const entry of rehydrated) {
            expect(entry.kind === 'action' && entry.inverseAction).toBeTruthy();
        }

        // The registered inverses re-execute: one undo reverts the whole
        // reopened gesture against live rack state.
        const result = await freshUndo();
        expect(result.headConsumed).toBe(true);
        expect(freshYeastStore.value?.processors[0]?.params?.gate).toBe(0.8);
    });
});
