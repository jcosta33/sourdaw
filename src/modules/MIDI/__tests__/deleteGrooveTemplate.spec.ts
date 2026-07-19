import { beforeEach, describe, expect, it } from 'vitest';

import { handleDeleteGrooveTemplate } from '../handlers/groove/handleDeleteGrooveTemplate';
import { handleRestoreDeletedGrooveTemplate } from '../handlers/groove/handleRestoreDeletedGrooveTemplate';
import { STRAIGHT_GROOVE_TEMPLATE_ID } from '../models/GrooveTemplate';
import { defaultGrooveTemplateState, grooveTemplateStore } from '../stores/grooveTemplateStore';
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
        assignGrooveTemplate({ consumerType: 'yeast-processor', consumerId: 'y1', templateId: template.id, amount: 1 });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 't1',
            templateId: template.id,
            amount: 0.7,
        });

        const snapshot = deleteGrooveTemplate(template.id);
        expect(snapshot).not.toBeNull();
        expect(grooveTemplateStore.value?.assignments.map((assignment) => assignment.templateId)).toEqual([
            STRAIGHT_GROOVE_TEMPLATE_ID,
            STRAIGHT_GROOVE_TEMPLATE_ID,
        ]);

        if (!snapshot) {
            throw new Error('Expected deletion snapshot');
        }
        restoreDeletedGrooveTemplate(snapshot);
        expect(grooveTemplateStore.value?.templates).toContainEqual(template);
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
});
