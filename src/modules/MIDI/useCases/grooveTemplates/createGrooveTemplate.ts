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

import { markGrooveTemplateProjectWrite } from './markGrooveTemplateProjectWrite';
import { resolveGrooveTemplateName } from './resolveGrooveTemplateName';

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
    const existing = state.templates.find((candidate) => candidate.id === id);
    if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(template)) {
            throw new Error(`Groove template identity conflict: ${id}`);
        }
        return { status: 'no-write', template: existing };
    }
    grooveTemplateStore.set({ ...state, templates: [...state.templates, template] });
    markGrooveTemplateProjectWrite();
    return { status: 'written', template };
}
