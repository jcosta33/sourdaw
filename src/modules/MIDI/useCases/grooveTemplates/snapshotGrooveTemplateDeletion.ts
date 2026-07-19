import { STRAIGHT_GROOVE_TEMPLATE_ID } from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { type DeletedGrooveTemplateSnapshot } from './deleteGrooveTemplate';

export function snapshotGrooveTemplateDeletion(templateId: string): DeletedGrooveTemplateSnapshot | null {
    const state = grooveTemplateStore.value;
    const templateIndex = state?.templates.findIndex((template) => template.id === templateId) ?? -1;
    if (!state || templateIndex === -1 || templateId === STRAIGHT_GROOVE_TEMPLATE_ID) {
        return null;
    }
    const template = state.templates[templateIndex];
    if (!template) {
        return null;
    }
    return {
        template: structuredClone(template),
        templateIndex,
        assignments: state.assignments.flatMap((assignment, index) =>
            assignment.templateId === templateId ? [{ index, assignment: structuredClone(assignment) }] : []
        ),
    };
}
