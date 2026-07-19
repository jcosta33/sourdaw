import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { createGrooveTemplate, getMidiGrooveHandlers } from '#/modules/MIDI/useCases';

import { yeastStore, type YeastState } from '../../stores/yeastStore';
import { setYeastGrooveTemplate } from '../setYeastGrooveTemplate';

const mocks = vi.hoisted(() => ({
    loggerError: vi.fn(),
    mutateDoc: vi.fn(),
    setYeastRuntimeProjection: vi.fn(),
    waitForSnapshotTransaction: vi.fn<() => Promise<void>>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('../../engine/yeastRuntime', () => ({
    setYeastRuntimeProjection: mocks.setYeastRuntimeProjection,
}));

const initialYeastState: YeastState = {
    processors: [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false }],
    uiLevel: 1,
};

describe('setYeastGrooveTemplate', () => {
    let document: Record<string, unknown>;
    let commandGate: Promise<void>;
    let releaseCommand: () => void;

    beforeEach(() => {
        vi.clearAllMocks();
        document = {};
        commandGate = Promise.resolve();
        releaseCommand = () => undefined;
        mocks.waitForSnapshotTransaction.mockImplementation(() => commandGate);
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: (input) => {
                mocks.mutateDoc(input);
                input.changeFn(document);
            },
            waitForSnapshotTransaction: mocks.waitForSnapshotTransaction,
        });
        clearHandlerRegistry();
        registerHandlerMap(getMidiGrooveHandlers());
        clearUndoHistory();
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        createGrooveTemplate({
            id: 'test-pocket',
            name: 'Test pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        yeastStore.set(structuredClone(initialYeastState));
        flushAutomergeStorageWrites();
        mocks.mutateDoc.mockClear();
        clearUndoHistory();
    });

    afterEach(() => {
        releaseCommand();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearUndoHistory();
        clearHandlerRegistry();
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        yeastStore.set({ processors: [], uiLevel: 1 });
    });

    it('should preserve concurrent processor edits while refreshing runtime from current state', async () => {
        commandGate = new Promise<void>((resolve) => {
            releaseCommand = resolve;
        });
        const assigning = setYeastGrooveTemplate('groove-1', 'test-pocket', 0.75);
        await vi.waitFor(() => expect(mocks.waitForSnapshotTransaction).toHaveBeenCalledOnce());

        const concurrentState: YeastState = {
            processors: [
                { id: 'groove-1', type: 'groove', name: 'Concurrent rename', bypassed: true },
                { id: 'velocity-1', type: 'velocity', name: 'Concurrent velocity', bypassed: false },
            ],
            uiLevel: 3,
        };
        yeastStore.set(concurrentState);
        releaseCommand();
        await assigning;

        expect(yeastStore.value).toEqual(concurrentState);
        expect(mocks.setYeastRuntimeProjection).toHaveBeenLastCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ id: 'groove-1', bypassed: true }),
                expect.objectContaining({ id: 'velocity-1' }),
            ])
        );
    });

    it('should commit only the MIDI-owned assignment as one project change and one undo entry', async () => {
        await setYeastGrooveTemplate('groove-1', 'test-pocket', 0.75);
        flushAutomergeStorageWrites();

        expect(mocks.mutateDoc).toHaveBeenCalledTimes(1);
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Assign groove template']);
        expect(undoStore.value?.future).toEqual([]);
        expect(yeastStore.value).toEqual(initialYeastState);
    });

    it('should restore the committed runtime projection and surface a rejected assignment', async () => {
        clearHandlerRegistry();

        await expect(setYeastGrooveTemplate('groove-1', 'test-pocket', 0.75)).rejects.toThrow();

        expect(mocks.loggerError).toHaveBeenLastCalledWith(
            expect.objectContaining({ message: 'Failed to assign the Yeast groove template' })
        );
        expect(mocks.setYeastRuntimeProjection).toHaveBeenLastCalledWith([
            expect.objectContaining({ id: 'groove-1', type: 'groove' }),
        ]);
    });
});
