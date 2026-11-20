import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type GrooveTemplate, createStraightGrooveTemplate } from '../../../models/GrooveTemplate';
import { type GrooveTemplateAssignment, type GrooveTemplateState } from '../../../models/GrooveTemplateState';
import { projectGrooveTemplateState } from '../projectGrooveTemplateState';

function userTemplate(id: string): GrooveTemplate {
    return {
        id,
        name: `Groove ${id}`,
        schemaVersion: 1,
        subdivision: '1/16',
        slots: [{ index: 1, timingOffset: 0.1, dynamicsOffset: 0 }],
        provenance: { type: 'user', sourceId: id },
    };
}

function assignment(templateId: string): GrooveTemplateAssignment {
    return { consumerType: 'clip', consumerId: 'clip-1', templateId, amount: 0.5 };
}

const base: GrooveTemplateState = {
    templates: [userTemplate('pool-a'), userTemplate('pool-b')],
    assignments: [assignment('pool-a')],
};

function hasStringType(value: unknown): value is AppAction {
    return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
}

function inheritedNameAction(): AppAction {
    const parsed: unknown = JSON.parse('{"type":"constructor"}');
    if (!hasStringType(parsed)) {
        throw new Error('Fixture is not an action');
    }
    return parsed;
}

const ids = (state: GrooveTemplateState): string[] => state.templates.map((template) => template.id);

describe('projectGrooveTemplateState', () => {
    it('extractGroove adds the pinned proposal', () => {
        const action: AppAction = {
            type: 'extractGroove',
            payload: { clipId: 'clip-1', proposal: userTemplate('extracted'), sourceRevision: 'rev' },
        };
        expect(ids(projectGrooveTemplateState(base, [action]))).toEqual(['pool-a', 'pool-b', 'extracted']);
    });

    it('createGrooveTemplate adds the canonical template', () => {
        const { schemaVersion: _version, ...payload } = userTemplate(' created ');
        const projected = projectGrooveTemplateState(base, [{ type: 'createGrooveTemplate', payload }]);
        expect(ids(projected)).toEqual(['pool-a', 'pool-b', 'created']);
    });

    it('deleteGrooveTemplate removes the template and resets its assignments to straight', () => {
        const projected = projectGrooveTemplateState(base, [
            { type: 'deleteGrooveTemplate', payload: { templateId: 'pool-a' } },
        ]);
        expect(ids(projected)).toEqual(['pool-b']);
        expect(projected.assignments.map((row) => row.templateId)).toEqual(['groove-straight']);
    });

    it('restoreDeletedGrooveTemplate reinserts the template at its index', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'restoreDeletedGrooveTemplate',
                payload: { template: userTemplate('back'), templateIndex: 1, assignments: [] },
            },
        ]);
        expect(ids(projected)).toEqual(['pool-a', 'back', 'pool-b']);
    });

    it('assignGrooveTemplate replaces the consumer assignment', () => {
        const projected = projectGrooveTemplateState(base, [
            { type: 'assignGrooveTemplate', payload: assignment('pool-b') },
        ]);
        expect(projected.assignments).toEqual([assignment('pool-b')]);
    });

    it('applyGroove assigns the groove to the clip at the given amount', () => {
        const projected = projectGrooveTemplateState(base, [
            { type: 'applyGroove', payload: { clipId: 'clip-2', grooveId: 'pool-b', amount: 0.25 } },
        ]);
        expect(projected.assignments).toEqual([
            assignment('pool-a'),
            { consumerType: 'clip', consumerId: 'clip-2', templateId: 'pool-b', amount: 0.25 },
        ]);
    });

    it('restoreGrooveAssignment removes an assignment restored to none', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'restoreGrooveAssignment',
                payload: { consumerType: 'clip', consumerId: 'clip-1', assignment: null },
            },
        ]);
        expect(projected.assignments).toEqual([]);
    });

    it('leaves the state unchanged for an action outside the groove family', () => {
        expect(projectGrooveTemplateState(base, [{ type: 'togglePlayback' }])).toBe(base);
    });

    it('leaves the state unchanged for an action type that is an inherited object name', () => {
        expect(projectGrooveTemplateState(base, [inheritedNameAction()])).toBe(base);
    });

    it('projects a batch in order', () => {
        const projected = projectGrooveTemplateState(base, [
            { type: 'deleteGrooveTemplate', payload: { templateId: 'pool-b' } },
            { type: 'applyGroove', payload: { clipId: 'clip-1', grooveId: 'pool-b' } },
        ]);
        expect(projected.assignments).toEqual([assignment('pool-a')]);
    });
});

describe('projectGrooveTemplateState refusals', () => {
    const builtin: GrooveTemplate = {
        ...userTemplate('builtin-swing'),
        provenance: { type: 'builtin', sourceId: 'swing' },
    };
    const withProtected: GrooveTemplateState = {
        templates: [createStraightGrooveTemplate(), builtin, ...base.templates],
        assignments: base.assignments,
    };

    it.each([
        ['an unknown template', 'missing'],
        ['the straight template', 'groove-straight'],
        ['a builtin template', 'builtin-swing'],
    ])('deleteGrooveTemplate leaves the state unchanged for %s', (_label, templateId) => {
        const projected = projectGrooveTemplateState(withProtected, [
            { type: 'deleteGrooveTemplate', payload: { templateId } },
        ]);
        expect(projected).toBe(withProtected);
    });

    it('deleteGrooveTemplate guarded by a different expected template leaves the state unchanged', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'deleteGrooveTemplate',
                payload: { templateId: 'pool-b', expectedTemplate: { ...userTemplate('pool-b'), name: 'Edited' } },
            },
        ]);
        expect(projected).toBe(base);
    });

    it('deleteGrooveTemplate guarded by the matching template leaves the state unchanged while it is assigned', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'deleteGrooveTemplate',
                payload: { templateId: 'pool-a', expectedTemplate: userTemplate('pool-a') },
            },
        ]);
        expect(projected).toBe(base);
    });

    it('deleteGrooveTemplate guarded by the matching template deletes it once unassigned', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'deleteGrooveTemplate',
                payload: { templateId: 'pool-b', expectedTemplate: userTemplate('pool-b') },
            },
        ]);
        expect(ids(projected)).toEqual(['pool-a']);
    });

    it('restoreDeletedGrooveTemplate leaves the state unchanged for an invalid template', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'restoreDeletedGrooveTemplate',
                payload: { template: { ...userTemplate('back'), name: ' ' }, templateIndex: 0, assignments: [] },
            },
        ]);
        expect(projected).toBe(base);
    });

    it('restoreDeletedGrooveTemplate leaves the state unchanged when the id is already present', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'restoreDeletedGrooveTemplate',
                payload: { template: userTemplate('pool-a'), templateIndex: 0, assignments: [] },
            },
        ]);
        expect(projected).toBe(base);
    });

    describe('restoreDeletedGrooveTemplate prior assignments', () => {
        const straightAssignment = (amount: number): GrooveTemplateAssignment => ({
            consumerType: 'clip',
            consumerId: 'clip-1',
            templateId: 'groove-straight',
            amount,
        });
        const restore = (amount: number): GrooveTemplateState =>
            projectGrooveTemplateState(
                { templates: [createStraightGrooveTemplate()], assignments: [straightAssignment(amount)] },
                [
                    {
                        type: 'restoreDeletedGrooveTemplate',
                        payload: {
                            template: userTemplate('back'),
                            templateIndex: 1,
                            assignments: [{ assignment: { ...assignment('back'), amount: 0.5 } }],
                        },
                    },
                ]
            );

        it('re-applies the assignment to a consumer still on straight at the recorded amount', () => {
            expect(restore(0.5).assignments).toEqual([{ ...assignment('back'), amount: 0.5 }]);
        });

        it('keeps a consumer reassigned to another template at the recorded amount', () => {
            const reassigned: GrooveTemplateState = {
                templates: [createStraightGrooveTemplate(), userTemplate('pool-b')],
                assignments: [{ ...assignment('pool-b'), amount: 0.5 }],
            };
            const projected = projectGrooveTemplateState(reassigned, [
                {
                    type: 'restoreDeletedGrooveTemplate',
                    payload: {
                        template: userTemplate('back'),
                        templateIndex: 1,
                        assignments: [{ assignment: { ...assignment('back'), amount: 0.5 } }],
                    },
                },
            ]);
            expect(projected.assignments).toEqual([{ ...assignment('pool-b'), amount: 0.5 }]);
        });

        it('keeps a consumer on straight whose amount has changed since the delete', () => {
            expect(restore(0.8).assignments).toEqual([straightAssignment(0.8)]);
        });
    });

    it('restoreGrooveAssignment leaves the state unchanged when the expected assignment no longer matches', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'restoreGrooveAssignment',
                payload: {
                    consumerType: 'clip',
                    consumerId: 'clip-1',
                    assignment: null,
                    expectedAssignment: assignment('pool-b'),
                },
            },
        ]);
        expect(projected).toBe(base);
    });

    it('extractGroove leaves the state unchanged for a proposal that is not a template', () => {
        const projected = projectGrooveTemplateState(base, [
            { type: 'extractGroove', payload: { clipId: 'clip-1', proposal: null, sourceRevision: 'rev' } },
        ]);
        expect(projected).toBe(base);
    });

    it('extractGroove leaves the state unchanged when the proposal id already exists', () => {
        const projected = projectGrooveTemplateState(base, [
            {
                type: 'extractGroove',
                payload: { clipId: 'clip-1', proposal: userTemplate('pool-a'), sourceRevision: 'rev' },
            },
        ]);
        expect(projected).toBe(base);
    });

    it.each([
        ['an id that cannot be canonical', { ...userTemplate(' '), schemaVersion: undefined }],
        ['an invalid template', { ...userTemplate('fresh'), name: ' ', schemaVersion: undefined }],
        ['an id already present', { ...userTemplate('pool-a'), schemaVersion: undefined }],
    ])('createGrooveTemplate leaves the state unchanged for %s', (_label, payload) => {
        const { schemaVersion: _version, ...rest } = payload;
        const projected = projectGrooveTemplateState(base, [{ type: 'createGrooveTemplate', payload: rest }]);
        expect(projected).toBe(base);
    });
});
