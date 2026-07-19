import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDeleteGrooveTemplate } from '../handlers/groove/handleDeleteGrooveTemplate';
import { handleRestoreDeletedGrooveTemplate } from '../handlers/groove/handleRestoreDeletedGrooveTemplate';
import { STRAIGHT_GROOVE_TEMPLATE_ID } from '../models/GrooveTemplate';
import {
    defaultGrooveTemplateState,
    grooveTemplateStore,
    isGrooveTemplateState,
    sanitizeGrooveTemplateState,
} from '../stores/grooveTemplateStore';
import { assignGrooveTemplate } from '../useCases/grooveTemplates/assignGrooveTemplate';
import { createGrooveTemplate } from '../useCases/grooveTemplates/createGrooveTemplate';
import { deleteGrooveTemplate } from '../useCases/grooveTemplates/deleteGrooveTemplate';
import { restoreDeletedGrooveTemplate } from '../useCases/grooveTemplates/restoreDeletedGrooveTemplate';

describe('deleteGrooveTemplate', () => {
    beforeEach(() => grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState)));

    it('falls every reference back to Straight and restores template plus references deterministically', () => {
        const template = createGrooveTemplate({
            id: 'pocket',
            name: 'Pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'manual' },
        });
        assignGrooveTemplate({
            consumerType: 'yeast-processor',
            consumerId: 'y1',
            templateId: template.template.id,
            amount: 1,
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 't1',
            templateId: template.template.id,
            amount: 0.7,
        });

        const snapshot = deleteGrooveTemplate(template.template.id);
        expect(snapshot).not.toBeNull();
        expect(grooveTemplateStore.value?.assignments.map((assignment) => assignment.templateId)).toEqual([
            STRAIGHT_GROOVE_TEMPLATE_ID,
            STRAIGHT_GROOVE_TEMPLATE_ID,
        ]);

        if (!snapshot) {
            throw new Error('Expected deletion snapshot');
        }
        restoreDeletedGrooveTemplate(snapshot);
        expect(grooveTemplateStore.value?.templates).toContainEqual(template.template);
        expect(grooveTemplateStore.value?.assignments).toEqual([
            { consumerType: 'yeast-processor', consumerId: 'y1', templateId: 'pocket', amount: 1 },
            { consumerType: 'toaster-pattern', consumerId: 't1', templateId: 'pocket', amount: 0.7 },
        ]);
    });

    it('captures template and references in one undoable deletion action', () => {
        createGrooveTemplate({
            id: 'delete-handler',
            name: 'Delete handler',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'manual' },
        });
        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'clip-handler',
            templateId: 'delete-handler',
            amount: 0.5,
        });
        const action = { type: 'deleteGrooveTemplate' as const, payload: { templateId: 'delete-handler' } };
        const description = handleDeleteGrooveTemplate.describe(action);
        expect(handleDeleteGrooveTemplate.undoable).toBe(true);
        void handleDeleteGrooveTemplate.execute(action);
        expect(grooveTemplateStore.value?.assignments[0]?.templateId).toBe(STRAIGHT_GROOVE_TEMPLATE_ID);

        if (description.inverseAction?.type !== 'restoreDeletedGrooveTemplate') {
            throw new Error('Expected deletion inverse');
        }
        void handleRestoreDeletedGrooveTemplate.execute(description.inverseAction);
        expect(grooveTemplateStore.value?.templates.some((template) => template.id === 'delete-handler')).toBe(true);
        expect(grooveTemplateStore.value?.assignments[0]?.templateId).toBe('delete-handler');
    });

    it('surfaces a deterministic conflict when a collaborator recreates the deleted identity', () => {
        createGrooveTemplate({
            id: 'colliding-restore',
            name: 'Original',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'original' },
        });
        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'collision-clip',
            templateId: 'colliding-restore',
            amount: 0.5,
        });
        const snapshot = deleteGrooveTemplate('colliding-restore');
        if (!snapshot) {
            throw new Error('Expected deletion snapshot');
        }
        createGrooveTemplate({
            id: 'colliding-restore',
            name: 'Collaborator replacement',
            subdivision: '1/16',
            slots: [{ index: 2, timingOffset: -0.2, dynamicsOffset: 0.1 }],
            provenance: { type: 'user', sourceId: 'collaborator' },
        });
        const beforeRestore = structuredClone(grooveTemplateStore.value);

        expect(() => restoreDeletedGrooveTemplate(snapshot)).toThrow(
            'Cannot restore groove template "colliding-restore": identity was recreated with different content'
        );
        expect(grooveTemplateStore.value).toEqual(beforeRestore);
    });

    it('restores a deleted template without overwriting a newer collaborator assignment', () => {
        for (const id of ['deleted-template', 'collaborator-template']) {
            createGrooveTemplate({
                id,
                name: id,
                subdivision: '1/16',
                slots: [],
                provenance: { type: 'user', sourceId: id },
            });
        }
        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'shared-delete-clip',
            templateId: 'deleted-template',
            amount: 0.5,
        });
        const snapshot = deleteGrooveTemplate('deleted-template');
        if (!snapshot) {
            throw new Error('Expected deletion snapshot');
        }
        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'shared-delete-clip',
            templateId: 'collaborator-template',
            amount: 0.9,
        });

        restoreDeletedGrooveTemplate(snapshot);

        expect(grooveTemplateStore.value?.templates).toContainEqual(
            expect.objectContaining({ id: 'deleted-template' })
        );
        expect(grooveTemplateStore.value?.assignments).toContainEqual({
            consumerType: 'clip',
            consumerId: 'shared-delete-clip',
            templateId: 'collaborator-template',
            amount: 0.9,
        });
    });

    it('resolves collaborative canonical-name reuse before serializing the restore candidate', () => {
        createGrooveTemplate({
            id: 'deleted-pocket',
            name: 'Pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'deleted' },
        });
        const snapshot = deleteGrooveTemplate('deleted-pocket');
        if (!snapshot) {
            throw new Error('Expected deletion snapshot');
        }
        createGrooveTemplate({
            id: 'collaborator-pocket',
            name: 'Pocket',
            subdivision: '1/16',
            slots: [{ index: 2, timingOffset: -0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'collaborator' },
        });
        const setSpy = vi.spyOn(grooveTemplateStore, 'set');

        restoreDeletedGrooveTemplate(snapshot);

        const candidate = setSpy.mock.calls.at(-1)?.[0];
        expect(isGrooveTemplateState(candidate)).toBe(true);
        expect(sanitizeGrooveTemplateState(candidate)).toEqual(candidate);
        expect(candidate?.templates.find((template) => template.id === 'deleted-pocket')?.name).toBe('Pocket 2');
    });

    it('rejects a collaborative restore snapshot with a missing referent atomically', () => {
        createGrooveTemplate({
            id: 'deleted-valid',
            name: 'Deleted valid',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'deleted-valid' },
        });
        const snapshot = deleteGrooveTemplate('deleted-valid');
        if (!snapshot) {
            throw new Error('Expected deletion snapshot');
        }
        snapshot.assignments.push({
            index: 0,
            assignment: { consumerType: 'clip', consumerId: 'missing-ref', templateId: 'missing-template', amount: 1 },
        });
        const before = structuredClone(grooveTemplateStore.value);

        expect(() => restoreDeletedGrooveTemplate(snapshot)).toThrow('snapshot references a different template');
        expect(grooveTemplateStore.value).toEqual(before);
    });
});
