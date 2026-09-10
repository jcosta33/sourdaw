import { change, from, type Doc } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, undoHistoryStore } from '#/modules/Command/stores';
import { executeAppAction, redo, registerProductionCommandHandlers, undo } from '#/modules/Command/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate, getScopedGrooveConsumerId } from '#/modules/MIDI/useCases';

import { setActiveYeastDevice, type YeastProcessorInfo, yeastStore } from '../../stores/yeastStore';
import { YEAST_GROOVE_OWNER_ID } from '../../useCases/getYeastGrooveAssignment';

// Undoing an accidental processor removal (#4124): the removal also deleted the
// processor's groove assignments in the groove store, and the guarded inverse
// used to restore only the processor. The remove action's describe captures the
// assignments pre-write; this spec proves the inverse re-binds them — and that
// redo removes both again — through the full dispatch/undo/redo engine.

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const DEVICE_ID = 'device-groove-undo';
const TEMPLATE_ID = 'swing-undo';

type RootDocument = { yeast?: unknown };

function grooveProcessor(): YeastProcessorInfo {
    return { id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false, params: {} };
}

function scopedConsumerId(processorId: string): string {
    return getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: processorId });
}

function liveAssignment(processorId: string) {
    return grooveTemplateStore.value?.assignments.find(
        (assignment) => assignment.consumerId === scopedConsumerId(processorId)
    );
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

describe('Yeast processor removal undo restores groove assignments (#4124)', () => {
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
            processors: [
                grooveProcessor(),
                { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: false, params: {} },
            ],
            uiLevel: 3,
        });
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        setActiveYeastDevice(null);
        clearHandlerRegistry();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
    });

    it('re-binds the groove assignments on undo and removes them again on redo', async () => {
        const created = createGrooveTemplate({
            id: TEMPLATE_ID,
            name: 'Swing Undo',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'manual' },
        });
        const assigned = assignGrooveTemplate({
            consumerType: 'yeast-processor',
            consumerId: scopedConsumerId('groove-1'),
            templateId: created.template.id,
            amount: 0.75,
        });
        if (!assigned.ok) {
            throw new Error(`Expected the groove assignment to land: ${assigned.error.code}`);
        }

        await executeAppAction({
            type: 'removeYeastProcessor',
            payload: {
                processorId: 'groove-1',
                expectedProcessor: grooveProcessor(),
                expectedIndex: 0,
            },
        });
        expect(yeastStore.value?.processors.some((processor) => processor.id === 'groove-1')).toBe(false);
        expect(liveAssignment('groove-1')).toBeUndefined();

        const undone = await undo();
        expect(undone.headConsumed).toBe(true);
        expect(yeastStore.value?.processors[0]?.id).toBe('groove-1');
        expect(liveAssignment('groove-1')).toEqual({
            consumerType: 'yeast-processor',
            consumerId: scopedConsumerId('groove-1'),
            templateId: TEMPLATE_ID,
            amount: 0.75,
        });

        await redo();
        expect(yeastStore.value?.processors.some((processor) => processor.id === 'groove-1')).toBe(false);
        expect(liveAssignment('groove-1')).toBeUndefined();
    });

    it('restores a rack with no groove assignments for the removed processor unchanged', async () => {
        await executeAppAction({
            type: 'removeYeastProcessor',
            payload: {
                processorId: 'filter-1',
                expectedProcessor: { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: false, params: {} },
                expectedIndex: 1,
            },
        });
        expect(yeastStore.value?.processors).toHaveLength(1);

        const undone = await undo();
        expect(undone.headConsumed).toBe(true);
        expect(yeastStore.value?.processors.map((processor) => processor.id)).toEqual(['groove-1', 'filter-1']);
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
    });
});
