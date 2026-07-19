import { beforeEach, describe, expect, it } from 'vitest';

import { handleAssignGrooveTemplate } from '../handlers/groove/handleAssignGrooveTemplate';
import { handleRestoreGrooveAssignment } from '../handlers/groove/handleRestoreGrooveAssignment';
import { defaultGrooveTemplateState, grooveTemplateStore } from '../stores/grooveTemplateStore';
import { assignGrooveTemplate } from '../useCases/grooveTemplates/assignGrooveTemplate';
import { createGrooveTemplate } from '../useCases/grooveTemplates/createGrooveTemplate';
import { previewGrooveTemplate } from '../useCases/grooveTemplates/previewGrooveTemplate';
import { projectCommittedGroove } from '../useCases/grooveTemplates/projectCommittedGroove';

describe('groove preview and commit parity', () => {
    beforeEach(() => grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState)));

    it('uses the same projection and commits only the owning reference', () => {
        const template = createGrooveTemplate({
            id: 'shuffle',
            name: 'Shuffle',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'manual' },
        });
        const events = [{ id: 'n1', startBeat: 0.25, velocity: 100 }];
        const sourceSnapshot = structuredClone(events);
        const preview = previewGrooveTemplate({ events, templateId: template.id, amount: 0.5 });

        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'clip-1',
            templateId: template.id,
            amount: 0.5,
        });
        const committed = projectCommittedGroove({ events, consumerType: 'clip', consumerId: 'clip-1' });

        expect(committed).toEqual(preview);
        expect(events).toEqual(sourceSnapshot);
        expect(grooveTemplateStore.value?.assignments).toEqual([
            { consumerType: 'clip', consumerId: 'clip-1', templateId: 'shuffle', amount: 0.5 },
        ]);
    });

    it('makes assignment one undoable reference-only action', () => {
        const template = createGrooveTemplate({
            id: 'undoable',
            name: 'Undoable',
            subdivision: '1/16',
            slots: [],
            provenance: { type: 'user', sourceId: 'manual' },
        });
        const action = {
            type: 'assignGrooveTemplate' as const,
            payload: {
                consumerType: 'clip' as const,
                consumerId: 'clip-undo',
                templateId: template.id,
                amount: 0.75,
            },
        };
        const description = handleAssignGrooveTemplate.describe(action);
        expect(handleAssignGrooveTemplate.undoable).toBe(true);
        void handleAssignGrooveTemplate.execute(action);
        expect(grooveTemplateStore.value?.assignments).toContainEqual(action.payload);

        if (description.inverseAction?.type !== 'restoreGrooveAssignment') {
            throw new Error('Expected assignment inverse');
        }
        void handleRestoreGrooveAssignment.execute(description.inverseAction);
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
    });

    it('normalizes a non-finite assignment amount consistently with projection', () => {
        const template = createGrooveTemplate({
            id: 'finite-assignment',
            name: 'Finite assignment',
            subdivision: '1/16',
            slots: [{ index: 0, timingOffset: 0.1, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'manual' },
        });

        const assignment = assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'clip-nan',
            templateId: template.id,
            amount: Number.NaN,
        });

        expect(assignment?.amount).toBe(0);
        expect(grooveTemplateStore.value?.assignments).toContainEqual({
            consumerType: 'clip',
            consumerId: 'clip-nan',
            templateId: template.id,
            amount: 0,
        });
    });
});
