import { STRAIGHT_GROOVE_TEMPLATE_ID, type GrooveTemplate } from '../../models/GrooveTemplate';
import { type GrooveTemplateAssignment, grooveTemplateStore } from '../../stores/grooveTemplateStore';

export type DeletedGrooveTemplateSnapshot = {
    template: GrooveTemplate;
    templateIndex: number;
    assignments: Array<{ index: number; assignment: GrooveTemplateAssignment }>;
};

export function deleteGrooveTemplate(templateId: string): DeletedGrooveTemplateSnapshot | null {
    const state = grooveTemplateStore.value;
    const templateIndex = state?.templates.findIndex((template) => template.id === templateId) ?? -1;
    if (!state || templateIndex === -1 || templateId === STRAIGHT_GROOVE_TEMPLATE_ID) {
        return null;
    }
    const template = state.templates[templateIndex];
    if (!template) {
        return null;
    }
    const assignments = state.assignments.flatMap((assignment, index) =>
        assignment.templateId === templateId ? [{ index, assignment: structuredClone(assignment) }] : []
    );
    grooveTemplateStore.set({
        templates: state.templates.filter((candidate) => candidate.id !== templateId),
        assignments: state.assignments.map((assignment) =>
            assignment.templateId === templateId
                ? { ...assignment, templateId: STRAIGHT_GROOVE_TEMPLATE_ID }
                : assignment
        ),
    });
    return { template: structuredClone(template), templateIndex, assignments };
}
