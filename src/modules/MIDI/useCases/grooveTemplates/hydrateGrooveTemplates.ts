import {
    type GrooveTemplateState,
    grooveTemplateStore,
    sanitizeGrooveTemplateState,
} from '../../stores/grooveTemplateStore';

export function hydrateGrooveTemplates(state: GrooveTemplateState): void {
    grooveTemplateStore.set(sanitizeGrooveTemplateState(structuredClone(state)));
}
