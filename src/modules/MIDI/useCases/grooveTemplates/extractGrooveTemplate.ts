import {
    GROOVE_SUBDIVISIONS,
    GROOVE_TEMPLATE_SCHEMA_VERSION,
    createStraightGrooveTemplate,
    getGrooveSubdivisionSlotCount,
    getGrooveSubdivisionStepBeats,
    type GrooveTemplate,
} from '../../models/GrooveTemplate';

type GrooveSourceNote = {
    id: string;
    startBeat: number;
    velocity: number;
};

type ExtractGrooveTemplateInput = {
    sourceId: string;
    sourceName: string;
    analyzerVersion: number;
    subdivision: string;
    templateId?: string;
    notes: readonly GrooveSourceNote[];
};

type ExtractGrooveTemplateResult =
    | { ok: true; template: GrooveTemplate }
    | { ok: false; error: { code: 'empty-source'; sourceId: string } }
    | { ok: false; error: { code: 'unsupported-subdivision'; subdivision: string } };

export function extractGrooveTemplate(input: ExtractGrooveTemplateInput): ExtractGrooveTemplateResult {
    const subdivision = GROOVE_SUBDIVISIONS.find((candidate) => candidate === input.subdivision);
    if (!subdivision) {
        return { ok: false, error: { code: 'unsupported-subdivision', subdivision: input.subdivision } };
    }
    if (input.notes.length === 0) {
        return { ok: false, error: { code: 'empty-source', sourceId: input.sourceId } };
    }

    const stepBeats = getGrooveSubdivisionStepBeats(subdivision);
    const slotCount = getGrooveSubdivisionSlotCount(subdivision);
    const timingBySlot = new Map<number, number[]>();
    const dynamicsBySlot = new Map<number, number[]>();
    const meanVelocity = input.notes.reduce((sum, note) => sum + note.velocity, 0) / input.notes.length;

    for (const note of input.notes) {
        const nearestStep = Math.round(note.startBeat / stepBeats);
        const slotIndex = ((nearestStep % slotCount) + slotCount) % slotCount;
        const timingOffset = Math.max(-0.5, Math.min(0.5, (note.startBeat - nearestStep * stepBeats) / stepBeats));
        const dynamicsOffset = Math.max(-1, Math.min(1, (note.velocity - meanVelocity) / 127));
        const timings = timingBySlot.get(slotIndex) ?? [];
        timings.push(timingOffset);
        timingBySlot.set(slotIndex, timings);
        const dynamics = dynamicsBySlot.get(slotIndex) ?? [];
        dynamics.push(dynamicsOffset);
        dynamicsBySlot.set(slotIndex, dynamics);
    }

    const slots = [...timingBySlot.entries()]
        .sort(([left], [right]) => left - right)
        .map(([index, timings]) => {
            const dynamics = dynamicsBySlot.get(index) ?? [];
            return {
                index,
                timingOffset: timings.reduce((sum, value) => sum + value, 0) / timings.length,
                dynamicsOffset: dynamics.reduce((sum, value) => sum + value, 0) / dynamics.length,
            };
        });
    if (slots.every((slot) => Math.abs(slot.timingOffset) < 1e-9 && Math.abs(slot.dynamicsOffset) < 1e-9)) {
        return { ok: true, template: createStraightGrooveTemplate() };
    }

    return {
        ok: true,
        template: {
            id: input.templateId ?? `groove-${input.sourceId}-v${input.analyzerVersion}`,
            name: `${input.sourceName} groove`,
            schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION,
            subdivision,
            slots,
            provenance: { type: 'midi-clip', sourceId: input.sourceId, analyzerVersion: input.analyzerVersion },
        },
    };
}
