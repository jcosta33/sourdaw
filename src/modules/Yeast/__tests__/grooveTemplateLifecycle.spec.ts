import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import {
    assignGrooveTemplate,
    createGrooveTemplate,
    getMidiGrooveHandlers,
    getScopedGrooveConsumerId,
    getStraightGrooveTemplateId,
    hydrateGrooveTemplates,
} from '#/modules/MIDI/useCases';

import { deleteYeastGrooveTemplate } from '../useCases/deleteYeastGrooveTemplate';
import { getYeastGrooveAssignment, YEAST_GROOVE_OWNER_ID } from '../useCases/getYeastGrooveAssignment';
import { renameYeastGrooveTemplate } from '../useCases/renameYeastGrooveTemplate';

describe('Yeast groove template lifecycle', () => {
    beforeEach(() => {
        const document: Record<string, unknown> = {};
        configureAutomergeStoragePort({
            getDoc: () => document,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: (input) => input.changeFn(document),
            waitForSnapshotTransaction: () => Promise.resolve(),
        });
        clearHandlerRegistry();
        registerHandlerMap(getMidiGrooveHandlers());
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        flushAutomergeStorageWrites();
        clearUndoHistory();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearUndoHistory();
        clearHandlerRegistry();
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('routes rename through the shared MIDI action as one undoable write', async () => {
        createGrooveTemplate({
            id: 'user-pocket',
            name: 'User pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        flushAutomergeStorageWrites();
        clearUndoHistory();

        await renameYeastGrooveTemplate('user-pocket', 'Renamed pocket');

        expect(grooveTemplateStore.value?.templates.find((template) => template.id === 'user-pocket')?.name).toBe(
            'Renamed pocket'
        );
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual([
            'Rename groove template to "Renamed pocket"',
        ]);
    });

    it('reflects the MIDI-owned deleted-reference fallback without a Yeast catalog', async () => {
        createGrooveTemplate({
            id: 'delete-me',
            name: 'Delete me',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        const consumerId = getScopedGrooveConsumerId({ ownerId: YEAST_GROOVE_OWNER_ID, localId: 'groove-1' });
        assignGrooveTemplate({
            consumerType: 'yeast-processor',
            consumerId,
            templateId: 'delete-me',
            amount: 0.75,
        });
        flushAutomergeStorageWrites();
        clearUndoHistory();

        await deleteYeastGrooveTemplate('delete-me');

        expect(grooveTemplateStore.value?.templates.some((template) => template.id === 'delete-me')).toBe(false);
        expect(getYeastGrooveAssignment('groove-1')).toEqual(
            expect.objectContaining({ templateId: getStraightGrooveTemplateId(), amount: 0.75 })
        );
        expect(undoStore.value?.past.map((entry) => entry.label)).toEqual(['Delete groove template']);
    });

    it('reads templates and assignments restored by MIDI project hydration', () => {
        hydrateGrooveTemplates({
            templates: [
                ...defaultGrooveTemplateState.templates,
                {
                    id: 'restored-pocket',
                    name: 'Restored pocket',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
                    provenance: { type: 'user', sourceId: 'project' },
                },
            ],
            assignments: [
                {
                    consumerType: 'yeast-processor',
                    consumerId: getScopedGrooveConsumerId({
                        ownerId: YEAST_GROOVE_OWNER_ID,
                        localId: 'groove-restored',
                    }),
                    templateId: 'restored-pocket',
                    amount: 0.6,
                },
            ],
        });

        expect(grooveTemplateStore.value?.templates).toContainEqual(
            expect.objectContaining({ id: 'restored-pocket', name: 'Restored pocket' })
        );
        expect(getYeastGrooveAssignment('groove-restored')).toEqual(
            expect.objectContaining({ templateId: 'restored-pocket', amount: 0.6 })
        );
        expect(vi.isMockFunction(grooveTemplateStore.set)).toBe(false);
    });
});
