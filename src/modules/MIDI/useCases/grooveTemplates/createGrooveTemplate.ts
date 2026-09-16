import { valuesEqual } from '#/utils/structuralEquality';

import {
    type GrooveSubdivision,
    type GrooveTemplate,
    type GrooveTemplateProvenance,
    type GrooveTemplateSlot,
} from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { markGrooveTemplateProjectWrite } from './markGrooveTemplateProjectWrite';
import { prepareGrooveTemplateCreation } from './prepareGrooveTemplateCreation';

type CreateGrooveTemplateInput = {
    id: string;
    name: string;
    subdivision: GrooveSubdivision;
    slots: GrooveTemplateSlot[];
    provenance: GrooveTemplateProvenance;
};

type CreateGrooveTemplateResult = {
    status: 'written' | 'no-write';
    template: GrooveTemplate;
};

export function createGrooveTemplate(input: CreateGrooveTemplateInput): CreateGrooveTemplateResult {
    const state = grooveTemplateStore.value;
    if (!state) {
        throw new Error('Groove template state is unavailable');
    }

    const template = prepareGrooveTemplateCreation(input);
    const existing = state.templates.find((candidate) => candidate.id === template.id);
    if (existing) {
        if (!valuesEqual(existing, template)) {
            throw new Error(`Groove template identity conflict: ${template.id}`);
        }
        return { status: 'no-write', template: existing };
    }
    grooveTemplateStore.set({ ...state, templates: [...state.templates, template] });
    markGrooveTemplateProjectWrite();
    return { status: 'written', template };
}
