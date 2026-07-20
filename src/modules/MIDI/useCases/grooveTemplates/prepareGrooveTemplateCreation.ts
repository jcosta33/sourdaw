import {
    GROOVE_TEMPLATE_SCHEMA_VERSION,
    canonicalizeGrooveTemplateId,
    getGrooveSubdivisionSlotCount,
    isGrooveTemplate,
    type GrooveSubdivision,
    type GrooveTemplate,
    type GrooveTemplateProvenance,
    type GrooveTemplateSlot,
} from '../../models/GrooveTemplate';
import { grooveTemplateStore } from '../../stores/grooveTemplateStore';

import { resolveGrooveTemplateName } from './resolveGrooveTemplateName';

type PrepareGrooveTemplateCreationInput = {
    id: string;
    name: string;
    subdivision: GrooveSubdivision;
    slots: GrooveTemplateSlot[];
    provenance: GrooveTemplateProvenance;
};

export function prepareGrooveTemplateCreation(input: PrepareGrooveTemplateCreationInput): GrooveTemplate {
    const state = grooveTemplateStore.value;
    if (!state) {
        throw new Error('Groove template state is unavailable');
    }

    const id = canonicalizeGrooveTemplateId(input.id);
    if (!id) {
        throw new Error('Groove template ID must be nonempty');
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
        name: resolveGrooveTemplateName({
            requestedName: input.name,
            templates: state.templates,
            ignoreTemplateId: id,
        }),
        schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION,
        subdivision: input.subdivision,
        slots: [...slotsByIndex.values()].sort((left, right) => left.index - right.index),
        provenance: structuredClone(input.provenance),
    };
    if (!isGrooveTemplate(template)) {
        throw new Error('Groove template is not canonical');
    }
    return template;
}
