import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores/handlerRegistry';
import { hydrateUndoStoreFromSession, undoStore } from '#/modules/Command/stores/undoStore';
import { executeAppAction } from '#/modules/Command/useCases';
import { validateVersionedCommandArguments } from '#/modules/Command/useCases/versionedCommandArgumentKeys';
import { setActiveYeastDevice, yeastStore, type YeastState } from '../../stores/yeastStore';

// The session mirror round trip for a coalesced Yeast gesture (#2111): the
// group's entries persist to sessionStorage, a fresh module graph rehydrates
// them (proving the generated argument schemas accept the guarded forward,
// inverse and redo payloads), and the rehydrated inverses still re-execute
// against live rack state.

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const DEVICE_ID = 'device-mirror';

type RootDocument = { yeast?: unknown };

const YEAST_MIRROR_ACTION_TYPES = [
    'setYeastProcessorParam',
    'setYeastArpPattern',
    'setYeastProcessorBypass',
    'addYeastProcessor',
    'removeYeastProcessor',
    'reorderYeastProcessor',
] as const;

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
        undoStore.set({ past: [], future: [] });
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

        clearHandlerRegistry();
        for (const handlerMap of getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true })) {
            registerHandlerMap(handlerMap);
        }
        // Boot arms the mirror with the session contracts; without them the
        // persistence pass drops Yeast entries before any reopen can read them.
        hydrateUndoStoreFromSession(
            YEAST_MIRROR_ACTION_TYPES.map((actionType) => ({
                actionType,
                operationVersion: 1,
                role: 'forward' as const,
                validateArguments: (payload: unknown) => validateVersionedCommandArguments(actionType, payload),
            }))
        );
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
                const replayed = entry[key] as { type: string; payload: unknown } | null;
                if (replayed === null || replayed === undefined) {
                    // redoAction is present for both entries of this gesture.
                    expect(key).not.toBe('redoAction');
                    continue;
                }
                expect(validateVersionedCommandArguments(replayed.type, replayed.payload)).toBe(true);
            }
        }

        // A fresh module graph — the reopen. The mirror rehydrates only what
        // the current contracts accept, so two surviving entries prove both.
        vi.resetModules();
        const { undoStore: freshUndoStore } = await import('#/modules/Command/stores/undoStore');
        const { hydrateUndoStoreFromSession } = await import('#/modules/Command/stores/undoStore');
        const { clearHandlerRegistry: freshClear, registerHandlerMap: freshRegister } = await import(
            '#/modules/Command/stores/handlerRegistry'
        );
        const { getYeastHandlers } = await import('../../useCases');
        const { setActiveYeastDevice: freshPin, yeastStore: freshYeastStore } = await import('../../stores/yeastStore');
        const { undo: freshUndo } = await import('#/modules/Command/useCases/undo');
        const { getCommandHandler: freshGetCommandHandler } = await import('#/modules/Command/useCases/getCommandHandler');

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
        freshClear();
        freshRegister(getYeastHandlers());

        hydrateUndoStoreFromSession(
            YEAST_MIRROR_ACTION_TYPES.map((actionType) => ({
                actionType,
                operationVersion: 1,
                role: 'forward' as const,
                validateArguments: (payload: unknown) => validateVersionedCommandArguments(actionType, payload),
            }))
        );

        const rehydrated = freshUndoStore.value?.past ?? [];
        expect(rehydrated).toHaveLength(2);
        expect(new Set(rehydrated.map((entry) => entry.groupId)).size).toBe(1);
        // The registered inverses re-execute: one undo reverts the whole
        // reopened gesture against live rack state.
        for (const entry of rehydrated) {
            expect(entry.kind === 'action' && entry.inverseAction).toBeTruthy();
            if (entry.kind === 'action') {
                expect(freshGetCommandHandler(entry.inverseAction!)).toBeDefined();
            }
        }
        const result = await freshUndo();
        expect(result.headConsumed).toBe(true);
        expect(freshYeastStore.value?.processors[0]?.params?.gate).toBe(0.8);
    });
});
