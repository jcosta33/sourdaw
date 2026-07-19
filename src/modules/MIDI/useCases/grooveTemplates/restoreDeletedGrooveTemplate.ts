import { STRAIGHT_GROOVE_TEMPLATE_ID, isGrooveTemplate } from '../../models/GrooveTemplate';
import { isGrooveTemplateState } from '../../models/GrooveTemplateState';
import { isGrooveTemplateAssignment, grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { type DeletedGrooveTemplateSnapshot } from './deleteGrooveTemplate';
import { markGrooveTemplateProjectWrite } from './markGrooveTemplateProjectWrite';
import { resolveGrooveTemplateName } from './resolveGrooveTemplateName';

export function restoreDeletedGrooveTemplate(snapshot: DeletedGrooveTemplateSnapshot): void {
    const state = grooveTemplateStore.value;
    if (!state) {
        throw new Error('Cannot restore groove template: state is unavailable');
    }
    if (
        !isGrooveTemplate(snapshot.template) ||
        !Number.isInteger(snapshot.templateIndex) ||
        snapshot.assignments.some(
            (prior) =>
                !Number.isInteger(prior.index) ||
                !isGrooveTemplateAssignment(prior.assignment) ||
                prior.assignment.templateId !== snapshot.template.id
        )
    ) {
        throw new Error('Cannot restore groove template: snapshot references a different template or is not canonical');
    }
    const existingTemplate = state.templates.find((template) => template.id === snapshot.template.id);
    if (existingTemplate && JSON.stringify(existingTemplate) !== JSON.stringify(snapshot.template)) {
        throw new Error(
            `Cannot restore groove template "${snapshot.template.id}": identity was recreated with different content`
        );
    }

    const templates = [...state.templates];
    if (!existingTemplate) {
        const restoredTemplate = {
            ...structuredClone(snapshot.template),
            name: resolveGrooveTemplateName({
                requestedName: snapshot.template.name,
                templates,
            }),
        };
        templates.splice(Math.max(0, Math.min(snapshot.templateIndex, templates.length)), 0, restoredTemplate);
    }
    const assignments = [...state.assignments];
    for (const prior of [...snapshot.assignments].sort((left, right) => left.index - right.index)) {
        const existingIndex = assignments.findIndex(
            (candidate) =>
                candidate.consumerType === prior.assignment.consumerType &&
                candidate.consumerId === prior.assignment.consumerId
        );
        const existingAssignment = existingIndex === -1 ? undefined : assignments[existingIndex];
        if (
            existingAssignment?.templateId === STRAIGHT_GROOVE_TEMPLATE_ID &&
            existingAssignment.amount === prior.assignment.amount
        ) {
            assignments[existingIndex] = structuredClone(prior.assignment);
        }
    }
    const candidate = { templates, assignments };
    if (
        !isGrooveTemplateState(candidate) ||
        !candidate.templates.some((template) => template.id === snapshot.template.id)
    ) {
        throw new Error(`Cannot restore groove template "${snapshot.template.id}": candidate is not canonical`);
    }
    grooveTemplateStore.set(candidate);
    markGrooveTemplateProjectWrite();
}
