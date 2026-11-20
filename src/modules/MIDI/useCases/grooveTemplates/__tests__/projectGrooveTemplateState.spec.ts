import { describe, expect, it } from 'vitest';

import { type AppAction } from '#/utils/handlerContract';

import { type GrooveTemplate } from '../../../models/GrooveTemplate';
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
