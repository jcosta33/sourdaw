import { beforeEach, describe, expect, it } from 'vitest';

import { handleApplyGroove } from '../handlers/groove/handleApplyGroove';
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
        const preview = previewGrooveTemplate({ events, templateId: template.template.id, amount: 0.5 });

        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'clip-1',
            templateId: template.template.id,
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
                templateId: template.template.id,
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

    it('refuses assignment undo when a collaborator changed the expected post-action value', () => {
        for (const id of ['local-assignment', 'collaborator-assignment']) {
            createGrooveTemplate({
                id,
                name: id,
                subdivision: '1/16',
                slots: [],
                provenance: { type: 'user', sourceId: id },
            });
        }
        const action = {
            type: 'assignGrooveTemplate' as const,
            payload: {
                consumerType: 'clip' as const,
                consumerId: 'shared-clip',
                templateId: 'local-assignment',
                amount: 0.5,
            },
        };
        const description = handleAssignGrooveTemplate.describe(action);
        void handleAssignGrooveTemplate.execute(action);
        assignGrooveTemplate({
            consumerType: 'clip',
            consumerId: 'shared-clip',
            templateId: 'collaborator-assignment',
            amount: 0.9,
        });
        const inverseAction = description.inverseAction;
        if (inverseAction?.type !== 'restoreGrooveAssignment') {
            throw new Error('Expected assignment inverse');
        }

        expect(() => handleRestoreGrooveAssignment.execute(inverseAction)).toThrow(
            'Cannot restore groove assignment: current value diverged from the action result'
        );
        expect(grooveTemplateStore.value?.assignments).toContainEqual({
            consumerType: 'clip',
            consumerId: 'shared-clip',
            templateId: 'collaborator-assignment',
            amount: 0.9,
        });
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
            templateId: template.template.id,
            amount: Number.NaN,
        });

        expect(assignment).toEqual({
            ok: true,
            assignment: {
                consumerType: 'clip',
                consumerId: 'clip-nan',
                templateId: template.template.id,
                amount: 0,
            },
        });
        expect(grooveTemplateStore.value?.assignments).toContainEqual({
            consumerType: 'clip',
            consumerId: 'clip-nan',
            templateId: template.template.id,
            amount: 0,
        });
    });

    it.each(['swing-light', 'swing-heavy', 'mpc-60', 'sp-1200'])('resolves the %s command preset', (grooveId) => {
        void handleApplyGroove.execute({ type: 'applyGroove', payload: { clipId: 'factory-clip', grooveId } });

        expect(grooveTemplateStore.value?.assignments).toContainEqual({
            consumerType: 'clip',
            consumerId: 'factory-clip',
            templateId: grooveId,
            amount: 1,
        });
    });

    it('returns a typed failure without mutating state for an explicit missing template', () => {
        const before = structuredClone(grooveTemplateStore.value);

        expect(
            assignGrooveTemplate({
                consumerType: 'clip',
                consumerId: 'missing-clip',
                templateId: 'missing-template',
                amount: 1,
            })
        ).toEqual({ ok: false, error: { code: 'missing-template', templateId: 'missing-template' } });
        expect(grooveTemplateStore.value).toEqual(before);
        expect(() =>
            handleApplyGroove.execute({
                type: 'applyGroove',
                payload: { clipId: 'missing-clip', grooveId: 'missing-template' },
            })
        ).toThrow('Groove assignment rejected: missing-template');
        expect(grooveTemplateStore.value).toEqual(before);
    });
});
