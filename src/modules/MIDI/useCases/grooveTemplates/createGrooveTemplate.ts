import {
    GROOVE_TEMPLATE_SCHEMA_VERSION,
    canonicalizeGrooveTemplateId,
    getGrooveSubdivisionSlotCount,
    type GrooveSubdivision,
    type GrooveTemplate,
    type GrooveTemplateProvenance,
    type GrooveTemplateSlot,
} from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { markGrooveTemplateProjectWrite } from './markGrooveTemplateProjectWrite';
import { resolveGrooveTemplateName } from './resolveGrooveTemplateName';

type CreateGrooveTemplateInput = {
    id: string;
    name: string;
    subdivision: GrooveSubdivision;
    slots: GrooveTemplateSlot[];
    provenance: GrooveTemplateProvenance;
};

export function createGrooveTemplate(input: CreateGrooveTemplateInput): GrooveTemplate {
    const state = grooveTemplateStore.value;
    if (!state) {
        throw new Error('Groove template state is unavailable');
    }

    const id = canonicalizeGrooveTemplateId(input.id);
    if (!id) {
        throw new Error('Groove template ID must be nonempty');
    }
    const existing = state.templates.find((template) => template.id === id);
    if (existing) {
        return existing;
    }

    const slotCount = getGrooveSubdivisionSlotCount(input.subdivision);
    const slotsByIndex = new Map<number, GrooveTemplateSlot>();
    for (const slot of input.slots) {
        if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= slotCount) {
            continue;
        }
        slotsByIndex.set(slot.index, {
            index: slot.index,
            timingOffset: Math.max(-0.5, Math.min(0.5, slot.timingOffset)),
            dynamicsOffset: Math.max(-1, Math.min(1, slot.dynamicsOffset)),
        });
    }

    const template: GrooveTemplate = {
        id,
        name: resolveGrooveTemplateName({ requestedName: input.name, templates: state.templates }),
        schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION,
        subdivision: input.subdivision,
        slots: [...slotsByIndex.values()].sort((left, right) => left.index - right.index),
        provenance: structuredClone(input.provenance),
    };
    grooveTemplateStore.set({ ...state, templates: [...state.templates, template] });
    markGrooveTemplateProjectWrite();
    return template;
}
