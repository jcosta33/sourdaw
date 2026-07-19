import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { type DeletedGrooveTemplateSnapshot } from './deleteGrooveTemplate';
import { markGrooveTemplateProjectWrite } from './markGrooveTemplateProjectWrite';

export function restoreDeletedGrooveTemplate(snapshot: DeletedGrooveTemplateSnapshot): void {
    const state = grooveTemplateStore.value;
    if (!state) {
        throw new Error('Cannot restore groove template: state is unavailable');
    }
    const existingTemplate = state.templates.find((template) => template.id === snapshot.template.id);
    if (existingTemplate && JSON.stringify(existingTemplate) !== JSON.stringify(snapshot.template)) {
        throw new Error(
            `Cannot restore groove template "${snapshot.template.id}": identity was recreated with different content`
        );
    }

    const templates = [...state.templates];
    if (!existingTemplate) {
        templates.splice(
            Math.max(0, Math.min(snapshot.templateIndex, templates.length)),
            0,
            structuredClone(snapshot.template)
        );
    }
    const assignments = [...state.assignments];
    for (const prior of [...snapshot.assignments].sort((left, right) => left.index - right.index)) {
        const existingIndex = assignments.findIndex(
            (candidate) =>
                candidate.consumerType === prior.assignment.consumerType &&
                candidate.consumerId === prior.assignment.consumerId
        );
        if (existingIndex === -1) {
            assignments.splice(
                Math.max(0, Math.min(prior.index, assignments.length)),
                0,
                structuredClone(prior.assignment)
            );
        } else {
            assignments[existingIndex] = structuredClone(prior.assignment);
        }
    }
    grooveTemplateStore.set({ templates, assignments });
    markGrooveTemplateProjectWrite();
}
