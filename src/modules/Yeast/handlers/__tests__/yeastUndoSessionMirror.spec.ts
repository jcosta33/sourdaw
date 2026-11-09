import { change, from, load, save, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import { executeAppAction, registerProductionCommandHandlers, undo } from '#/modules/Command/useCases';

import { setActiveYeastDevice, yeastStore } from '../../stores/yeastStore';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

// The session mirror round trip for a coalesced Yeast gesture (#2111): the
// group's entries persist to sessionStorage, a fresh module graph rehydrates
// them (proving the generated argument schemas accept the guarded forward,
// inverse and redo payloads), and the rehydrated inverses still re-execute
// against live rack state.

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const DEVICE_ID = 'device-mirror';

type RootDocument = { yeast?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mirroredIds(entries: unknown): string[] {
    if (!Array.isArray(entries)) {
        throw new TypeError('Expected a mirrored history stack');
    }
    return entries.map((entry) => {
        if (!isRecord(entry) || typeof entry.id !== 'string') {
            throw new TypeError('Expected a mirrored history entry with an id');
        }
        return entry.id;
    });
}

async function waitForMirroredHistory(pastIds: readonly string[], futureIds: readonly string[]): Promise<void> {
    await vi.waitFor(() => {
        const raw = sessionStorage.getItem(UNDO_SESSION_KEY);
        expect(raw).not.toBeNull();
        const persisted: unknown = JSON.parse(raw!);
        if (!isRecord(persisted)) {
            throw new TypeError('Expected a mirrored history record');
        }
        expect(mirroredIds(persisted.past)).toEqual(pastIds);
        expect(mirroredIds(persisted.future)).toEqual(futureIds);
    });
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
    let cleanupReopenedGraph: (() => void) | null = null;

    beforeEach(() => {
        cleanupReopenedGraph = null;
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

    afterEach(() => {
        cleanupReopenedGraph?.();
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

        const livePast = undoHistoryStore.value?.past ?? [];
        expect(livePast).toHaveLength(2);
        await waitForMirroredHistory(
            livePast.map((entry) => entry.id),
            []
        );

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
            if (!isRecord(entry)) {
                throw new Error('Expected every mirrored entry to be a record');
            }
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
        const { clearHandlerRegistry: freshClearRegistry, undoHistoryStore: freshUndoHistoryStore } =
            await import('#/modules/Command/stores');
        const { configureAutomergeStoragePort: freshConfigurePort, flushAutomergeStorageWrites: freshFlushWrites } =
            await import('#/infra/store/storage/createAutomergeStorage');
        const { setActiveYeastDevice: freshPin, yeastStore: freshYeastStore } = await import('../../stores/yeastStore');
        const { undo: freshUndo } = await import('#/modules/Command/useCases');

        document = from({});
        freshConfigurePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        });
        cleanupReopenedGraph = () => {
            freshFlushWrites();
            freshConfigurePort(null);
            freshPin(null);
            freshClearRegistry();
        };
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
        freshFlushWrites();
        await waitForMirroredHistory(
            freshUndoHistoryStore.value?.past.map((entry) => entry.id) ?? [],
            freshUndoHistoryStore.value?.future.map((entry) => entry.id) ?? []
        );
    });

    it('rehydrates a saved empty Arpeggiator add capture and redoes its exact old shape', async () => {
        await executeAppAction({
            type: 'addYeastProcessor',
            payload: { processorId: 'old-arp', type: 'arpeggiator', name: 'Old Arp' },
        });
        await undo();
        const pending = undoHistoryStore.value?.future.at(-1);
        if (pending?.kind !== 'action' || pending.inverseAction?.type !== 'removeYeastProcessor') {
            throw new Error('Expected a pending Arpeggiator add');
        }
        const oldEntry = {
            ...pending,
            inverseAction: {
                ...pending.inverseAction,
                payload: {
                    ...pending.inverseAction.payload,
                    expectedProcessor: { ...pending.inverseAction.payload.expectedProcessor, params: {} },
                },
            },
        };
        undoHistoryStore.set({ past: [], future: [oldEntry] });
        const savedProject = save(document);
        await waitForMirroredHistory([], [oldEntry.id]);
        const stored: unknown = JSON.parse(sessionStorage.getItem(UNDO_SESSION_KEY)!);
        if (!isRecord(stored) || !Array.isArray(stored.future)) {
            throw new Error('Expected the saved future stack');
        }
        expect(stored.future[0]).toMatchObject({
            inverseAction: { type: 'removeYeastProcessor', payload: { expectedProcessor: { params: {} } } },
        });
        expect(stored.future[0]).toHaveProperty(['inverseAction', 'payload', 'expectedProcessor', 'params'], {});

        vi.resetModules();
        const { getProductionCommandHandlerMaps: freshMaps } = await import('#/app/getProductionCommandHandlerMaps');
        const {
            redo: freshRedo,
            registerProductionCommandHandlers: freshRegister,
            undo: freshUndo,
        } = await import('#/modules/Command/useCases');
        const { clearHandlerRegistry: freshClearRegistry, undoHistoryStore: freshHistory } =
            await import('#/modules/Command/stores');
        const { configureAutomergeStoragePort: freshConfigurePort, flushAutomergeStorageWrites: freshFlushWrites } =
            await import('#/infra/store/storage/createAutomergeStorage');
        const {
            setActiveYeastDevice: freshPin,
            yeastStore: freshYeastStore,
            readYeastRack: freshReadRack,
        } = await import('../../stores/yeastStore');

        document = load<RootDocument>(savedProject);
        freshConfigurePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                document = change(document, (draft) => changeFn(draft as unknown as Record<string, unknown>));
            },
        });
        cleanupReopenedGraph = () => {
            freshFlushWrites();
            freshConfigurePort(null);
            freshPin(null);
            freshClearRegistry();
        };
        freshYeastStore.hydrate();
        freshPin(DEVICE_ID);
        expect(freshYeastStore.value).not.toBeNull();
        expect(freshReadRack(DEVICE_ID).processors).toHaveLength(1);
        freshRegister(freshMaps({ canMutateBranchMetadata: () => true }));
        const rehydrated = freshHistory.value?.future.at(-1);
        if (
            rehydrated?.kind !== 'action' ||
            rehydrated.action.type !== 'addYeastProcessor' ||
            rehydrated.inverseAction?.type !== 'removeYeastProcessor'
        ) {
            throw new Error('Expected the saved add capture to rehydrate');
        }
        expect(rehydrated.inverseAction.payload.expectedProcessor.params).toEqual({});

        await freshRedo();
        freshFlushWrites();
        expect(freshHistory.value?.future).toHaveLength(0);
        expect(freshReadRack(DEVICE_ID).processors.find((entry) => entry.id === 'old-arp')?.params ?? {}).toEqual({});
        expect(structuredClone(document.yeast)).toMatchObject({
            racks: { [DEVICE_ID]: { processors: { 'old-arp': { deleted: false, value: { params: {} } } } } },
        });
        expect(structuredClone(document.yeast)).toHaveProperty(
            ['racks', DEVICE_ID, 'processors', 'old-arp', 'value', 'params'],
            {}
        );
        expect(freshHistory.value?.past.at(-1)).toBe(rehydrated);
        expect(rehydrated.inverseAction.payload.expectedProcessor.params).toEqual({});
        await waitForMirroredHistory([rehydrated.id], []);

        await freshUndo();
        freshFlushWrites();
        expect(freshReadRack(DEVICE_ID).processors.some((entry) => entry.id === 'old-arp')).toBe(false);
        await waitForMirroredHistory([], [rehydrated.id]);
    });
});
