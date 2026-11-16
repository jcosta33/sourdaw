import { type AppAction } from '#/utils/handlerContract';
import { valuesEqual } from '#/utils/structuralEquality';

import {
    GROOVE_TEMPLATE_SCHEMA_VERSION,
    STRAIGHT_GROOVE_TEMPLATE_ID,
    canonicalizeGrooveTemplateId,
    isGrooveTemplate,
} from '../../models/GrooveTemplate';
import {
    type GrooveTemplateAssignment,
    type GrooveTemplateState,
    isGrooveTemplateAssignment,
} from '../../models/GrooveTemplateState';

import { canonicalizeGrooveTemplateAssignment } from './canonicalizeGrooveTemplateAssignment';

function withAssignment(state: GrooveTemplateState, assignment: GrooveTemplateAssignment): GrooveTemplateState {
    const others = state.assignments.filter(
        (candidate) =>
            candidate.consumerType !== assignment.consumerType || candidate.consumerId !== assignment.consumerId
    );
    return { ...state, assignments: [...others, assignment] };
}

function withoutAssignment(
    state: GrooveTemplateState,
    consumerType: GrooveTemplateAssignment['consumerType'],
    consumerId: string
): GrooveTemplateState {
    return {
        ...state,
        assignments: state.assignments.filter(
            (candidate) => candidate.consumerType !== consumerType || candidate.consumerId !== consumerId
        ),
    };
}

function hasTemplate(state: GrooveTemplateState, templateId: string): boolean {
    return state.templates.some((template) => template.id === templateId);
}

function assign(state: GrooveTemplateState, assignment: GrooveTemplateAssignment | null): GrooveTemplateState {
    if (assignment === null || !hasTemplate(state, assignment.templateId)) {
        return state;
    }
    return withAssignment(state, assignment);
}

function findAssignment(
    state: GrooveTemplateState,
    consumerType: GrooveTemplateAssignment['consumerType'],
    consumerId: string
): GrooveTemplateAssignment | null {
    return (
        state.assignments.find(
            (candidate) => candidate.consumerType === consumerType && candidate.consumerId === consumerId
        ) ?? null
    );
}

function deleteTemplate(
    state: GrooveTemplateState,
    action: Extract<AppAction, { type: 'deleteGrooveTemplate' }>
): GrooveTemplateState {
    const { templateId, expectedTemplate } = action.payload;
    const template = state.templates.find((candidate) => candidate.id === templateId);
    if (!template || templateId === STRAIGHT_GROOVE_TEMPLATE_ID || template.provenance.type === 'builtin') {
        return state;
    }
    const guarded = expectedTemplate !== undefined;
    if (
        guarded &&
        (!valuesEqual(template, expectedTemplate) ||
            state.assignments.some((assignment) => assignment.templateId === templateId))
    ) {
        return state;
    }
    return {
        templates: state.templates.filter((candidate) => candidate.id !== templateId),
        assignments: state.assignments.map((assignment) => resetAssignmentOfDeletedTemplate(assignment, templateId)),
    };
}

function resetAssignmentOfDeletedTemplate(
    assignment: GrooveTemplateState['assignments'][number],
    deletedTemplateId: string
): GrooveTemplateState['assignments'][number] {
    if (assignment.templateId !== deletedTemplateId) {
        return assignment;
    }
    return { ...assignment, templateId: STRAIGHT_GROOVE_TEMPLATE_ID };
}

function restoreDeletedTemplate(
    state: GrooveTemplateState,
    action: Extract<AppAction, { type: 'restoreDeletedGrooveTemplate' }>
): GrooveTemplateState {
    const { template, templateIndex, assignments } = action.payload;
    if (!isGrooveTemplate(template) || hasTemplate(state, template.id)) {
        return state;
    }
    const templates = [...state.templates];
    templates.splice(Math.max(0, Math.min(templateIndex, templates.length)), 0, structuredClone(template));
    let restored: GrooveTemplateState = { ...state, templates };
    for (const prior of assignments) {
        const current = findAssignment(restored, prior.assignment.consumerType, prior.assignment.consumerId);
        if (
            isGrooveTemplateAssignment(prior.assignment) &&
            current?.templateId === STRAIGHT_GROOVE_TEMPLATE_ID &&
            current.amount === prior.assignment.amount
        ) {
            restored = withAssignment(restored, prior.assignment);
        }
    }
    return restored;
}

function restoreAssignment(
    state: GrooveTemplateState,
    action: Extract<AppAction, { type: 'restoreGrooveAssignment' }>
): GrooveTemplateState {
    const { consumerType, consumerId, assignment, expectedAssignment } = action.payload;
    const current = findAssignment(state, consumerType, consumerId);
    if (expectedAssignment !== undefined && !valuesEqual(current, expectedAssignment)) {
        return state;
    }
    if (assignment === null) {
        return withoutAssignment(state, consumerType, consumerId);
    }
    return isGrooveTemplateAssignment(assignment) ? withAssignment(state, assignment) : state;
}

function projectAction(state: GrooveTemplateState, action: AppAction): GrooveTemplateState {
    switch (action.type) {
        case 'extractGroove': {
            // Only a pinned extraction names the template it creates; one that found no groove creates none.
            const { proposal } = action.payload;
            if (!isGrooveTemplate(proposal) || hasTemplate(state, proposal.id)) {
                return state;
            }
            return { ...state, templates: [...state.templates, structuredClone(proposal)] };
        }
        case 'createGrooveTemplate': {
            const id = canonicalizeGrooveTemplateId(action.payload.id);
            const template = { ...action.payload, id, schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION };
            if (id === null || !isGrooveTemplate(template) || hasTemplate(state, id)) {
                return state;
            }
            return { ...state, templates: [...state.templates, structuredClone(template)] };
        }
        case 'deleteGrooveTemplate':
            return deleteTemplate(state, action);
        case 'restoreDeletedGrooveTemplate':
            return restoreDeletedTemplate(state, action);
        case 'assignGrooveTemplate':
            return assign(state, canonicalizeGrooveTemplateAssignment(action.payload));
        case 'applyGroove':
            return assign(
                state,
                canonicalizeGrooveTemplateAssignment({
                    consumerType: 'clip',
                    consumerId: action.payload.clipId,
                    templateId: action.payload.grooveId,
                    amount: action.payload.amount ?? 1,
                })
            );
        case 'restoreGrooveAssignment':
            return restoreAssignment(state, action);
        default:
            return state;
    }
}

/**
 * The groove pool and its assignments as they will be once the given batch actions have run, so a
 * later action in the same batch validates and describes its inverse against the state it will meet
 * rather than the live store, which no action of the batch has written yet. An action that would
 * refuse at execution leaves the projection unchanged; the batch then fails as a whole.
 */
export function projectGrooveTemplateState(
    state: GrooveTemplateState,
    actions: readonly AppAction[]
): GrooveTemplateState {
    return actions.reduce(projectAction, state);
}
