import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, redo, undo } from '#/modules/Command/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { defaultTransportState, tempoMapStore, transportStore } from '../../../stores';
import { getTransportHandlers } from '../../../useCases';

function reset_dirty_state(): void {
    const project = projectStore.value;
    if (!project) {
        throw new Error('Expected initialized project');
    }
    projectStore.set({ ...project, dirty: false });
}

describe('setTempo project dirty integration', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('set tempo project dirty integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getTransportHandlers());
        clearUndoHistory();
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
            dirty: false,
        });
        transportStore.set({ ...defaultTransportState, tempo: 120, playheadPosition: 0 });
        tempoMapStore.set({ changes: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('keeps the initialized project clean when the requested base tempo is already current', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 120 } });

        expect(transportStore.value?.tempo).toBe(120);
        expect(projectStore.value?.dirty).toBe(false);
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('commits a base-tempo edit, one targeted inverse, and dirty state through undo and redo', async () => {
        await executeAppAction({ type: 'setTempo', payload: { bpm: 133 } });

        expect(transportStore.value?.tempo).toBe(133);
        expect(projectStore.value?.dirty).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);

        tempoMapStore.set({ changes: [{ id: 'later-change', beat: 12, tempo: 96, curve: 'instant' }] });
        reset_dirty_state();
        await undo();
        expect(transportStore.value?.tempo).toBe(120);
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(96);
        expect(projectStore.value?.dirty).toBe(true);

        reset_dirty_state();
        await redo();
        expect(transportStore.value?.tempo).toBe(133);
        expect(projectStore.value?.dirty).toBe(true);
    });

    it('commits a named tempo-map edit and keeps its inverse targeted through undo and redo', async () => {
        tempoMapStore.set({ changes: [{ id: 'tempo-0', beat: 0, tempo: 96, curve: 'instant' }] });

        await executeAppAction({ type: 'setTempo', payload: { bpm: 133, tempoChangeId: 'tempo-0' } });

        expect(tempoMapStore.value?.changes).toEqual([{ id: 'tempo-0', beat: 0, tempo: 133, curve: 'instant' }]);
        expect(projectStore.value?.dirty).toBe(true);
        expect(undoStore.value?.past).toHaveLength(1);

        tempoMapStore.set({
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 133, curve: 'instant' },
                { id: 'later-change', beat: 12, tempo: 144, curve: 'instant' },
            ],
        });
        transportStore.set({ ...transportStore.value!, playheadPosition: 12 });
        reset_dirty_state();
        await undo();
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(96);
        expect(tempoMapStore.value?.changes[1]?.tempo).toBe(144);
        expect(projectStore.value?.dirty).toBe(true);

        reset_dirty_state();
        await redo();
        expect(tempoMapStore.value?.changes[0]?.tempo).toBe(133);
        expect(projectStore.value?.dirty).toBe(true);
    });
});
