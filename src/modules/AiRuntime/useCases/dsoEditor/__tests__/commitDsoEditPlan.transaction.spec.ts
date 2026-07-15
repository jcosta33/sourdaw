import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    type ActionHandler,
    type AppAction,
    clearUndoHistory,
    executeAppAction,
    redo,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDsoSnapshotHandlers,
    mutateCrdtDoc,
    registerCrdtStorageRuntime,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { commitDsoEditPlan } from '../commitDsoEditPlan';

type SetTempoAction = Extract<AppAction, { type: 'setTempo' }>;

const mocks = vi.hoisted(() => ({
    executeDsos: vi.fn(),
}));

vi.mock('../executeDsos', () => ({
    executeDsos: mocks.executeDsos,
}));

describe('commitDsoEditPlan snapshot ownership', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetCrdtProjectAuthority('snapshot ownership');
        createCrdtDoc('dso-owned');
        createCrdtDoc('independent');
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'dso-owned',
            changeFn: (doc) => {
                doc.value = 'before';
            },
        });
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.value = 'before';
            },
        });
        registerCrdtStorageRuntime();
        registerHandlerMap(getDsoSnapshotHandlers());
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearHandlerRegistry();
        clearUndoHistory();
        vi.clearAllMocks();
    });

    it('keeps a paused unrelated mutation out of both undo and redo snapshots', async () => {
        let markDsoPaused!: () => void;
        let releaseDso!: () => void;
        const dsoPaused = new Promise<void>((resolve) => {
            markDsoPaused = resolve;
        });
        const dsoRelease = new Promise<void>((resolve) => {
            releaseDso = resolve;
        });
        const ownedStorage = createAutomergeStorage<{ value: string }>('dso-owned', 'dsoState');
        const setTempoHandler: ActionHandler<SetTempoAction> = {
            execute: (action) => {
                ownedStorage.set({ value: String(action.payload.bpm) });
            },
            describe: () => {
                const current = ownedStorage.get();
                return {
                    label: 'Set owned value',
                    inverseAction: current ? { type: 'setTempo', payload: { bpm: Number(current.value) } } : null,
                };
            },
            undoable: true,
        };
        registerHandlerMap({
            setTempo: setTempoHandler,
        });

        mocks.executeDsos.mockImplementation(async (_dsos: unknown, snapshotTransaction: object | undefined) => {
            expect(snapshotTransaction).toBeDefined();
            await executeAppAction(
                { type: 'setTempo', payload: { bpm: 121 } },
                {
                    skipUndo: true,
                    source: 'ai',
                    snapshotTransaction,
                }
            );
            markDsoPaused();
            await dsoRelease;
            await executeAppAction(
                { type: 'setTempo', payload: { bpm: 122 } },
                {
                    skipUndo: true,
                    source: 'ai',
                    snapshotTransaction,
                }
            );
            return { summaries: ['Changed owned document'], failures: [] };
        });

        const commit = commitDsoEditPlan({
            plan: {
                kind: 'edit_plan',
                moderation: 'allow',
                intent: 'change owned document',
                dsos: [{ op: 'set_tempo', bpm: 121 }],
            },
            userRequest: 'change the owned document',
            assistantMessageId: 'assistant-snapshot-ownership',
            reasoning: undefined,
        });

        await dsoPaused;
        mutateCrdtDoc<Record<string, unknown>>({
            id: 'independent',
            changeFn: (doc) => {
                doc.value = 'independent';
            },
        });
        let userActionSettled = false;
        const userAction = (async () => {
            await executeAppAction({ type: 'setTempo', payload: { bpm: 130 } });
            userActionSettled = true;
        })();
        await Promise.resolve();
        expect(userActionSettled).toBe(false);
        releaseDso();
        await commit;
        await userAction;
        flushAutomergeStorageWrites();

        expect(getCrdtDoc<Record<string, unknown>>('dso-owned')).toMatchObject({
            value: 'before',
            dsoState: { value: '130' },
        });
        expect(getCrdtDoc<Record<string, unknown>>('independent')).toMatchObject({ value: 'independent' });

        await undo();
        flushAutomergeStorageWrites();
        expect(getCrdtDoc<Record<string, unknown>>('dso-owned')).toMatchObject({
            value: 'before',
            dsoState: { value: '122' },
        });
        expect(getCrdtDoc<Record<string, unknown>>('independent')).toMatchObject({ value: 'independent' });

        await undo();
        expect(getCrdtDoc<Record<string, unknown>>('dso-owned')).toMatchObject({ value: 'before' });
        expect(getCrdtDoc<Record<string, unknown>>('dso-owned')).not.toHaveProperty('dsoState');
        expect(getCrdtDoc<Record<string, unknown>>('independent')).toMatchObject({ value: 'independent' });

        await redo();
        expect(getCrdtDoc<Record<string, unknown>>('dso-owned')).toMatchObject({
            value: 'before',
            dsoState: { value: '122' },
        });
        expect(getCrdtDoc<Record<string, unknown>>('independent')).toMatchObject({ value: 'independent' });

        await redo();
        flushAutomergeStorageWrites();
        expect(getCrdtDoc<Record<string, unknown>>('dso-owned')).toMatchObject({
            value: 'before',
            dsoState: { value: '130' },
        });
    });
});
