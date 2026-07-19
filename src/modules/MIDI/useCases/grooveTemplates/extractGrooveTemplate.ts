import {
    GROOVE_SUBDIVISIONS,
    GROOVE_TEMPLATE_SCHEMA_VERSION,
    STRAIGHT_GROOVE_TEMPLATE_ID,
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
    | { ok: false; error: { code: 'unsupported-subdivision'; subdivision: string } }
    | {
          ok: false;
          error: {
              code: 'invalid-source';
              sourceId: string;
              reason:
                  | 'invalid-source-id'
                  | 'invalid-source-name'
                  | 'invalid-analyzer-version'
                  | 'invalid-template-id'
                  | 'invalid-note-id'
                  | 'invalid-note-start'
                  | 'invalid-note-velocity';
          };
      };

type InvalidSourceReason = Extract<
    ExtractGrooveTemplateResult,
    { ok: false; error: { code: 'invalid-source' } }
>['error']['reason'];

function findInvalidSourceReason(input: ExtractGrooveTemplateInput, stepBeats: number): InvalidSourceReason | null {
    if (input.sourceId.trim().length === 0) {
        return 'invalid-source-id';
    }
    if (input.sourceName.trim().length === 0) {
        return 'invalid-source-name';
    }
    if (!Number.isInteger(input.analyzerVersion) || input.analyzerVersion <= 0) {
        return 'invalid-analyzer-version';
    }
    if (input.templateId !== undefined && input.templateId.trim().length === 0) {
        return 'invalid-template-id';
    }
    for (const note of input.notes) {
        if (note.id.trim().length === 0) {
            return 'invalid-note-id';
        }
        const stepPosition = note.startBeat / stepBeats;
        if (
            !Number.isFinite(note.startBeat) ||
            note.startBeat < 0 ||
            !Number.isFinite(stepPosition) ||
            !Number.isSafeInteger(Math.round(stepPosition))
        ) {
            return 'invalid-note-start';
        }
        if (!Number.isFinite(note.velocity) || note.velocity < 0 || note.velocity > 127) {
            return 'invalid-note-velocity';
        }
    }
    return null;
}

function compareSourceNotes(left: GrooveSourceNote, right: GrooveSourceNote): number {
    if (left.startBeat !== right.startBeat) {
        return left.startBeat - right.startBeat;
    }
    if (left.velocity !== right.velocity) {
        return left.velocity - right.velocity;
    }
    if (left.id < right.id) {
        return -1;
    }
    if (left.id > right.id) {
        return 1;
    }
    return 0;
}

function calculateStableMean(values: readonly number[]): number {
    const sortedValues = [...values].sort((left, right) => left - right);
    let sum = 0;
    let correction = 0;
    for (const value of sortedValues) {
        const next = sum + value;
        correction += Math.abs(sum) >= Math.abs(value) ? sum - next + value : value - next + sum;
        sum = next;
    }
    return (sum + correction) / sortedValues.length;
}

export function extractGrooveTemplate(input: ExtractGrooveTemplateInput): ExtractGrooveTemplateResult {
    const subdivision = GROOVE_SUBDIVISIONS.find((candidate) => candidate === input.subdivision);
    if (!subdivision) {
        return { ok: false, error: { code: 'unsupported-subdivision', subdivision: input.subdivision } };
    }
    const stepBeats = getGrooveSubdivisionStepBeats(subdivision);
    const invalidSourceReason = findInvalidSourceReason(input, stepBeats);
    if (invalidSourceReason) {
        return {
            ok: false,
            error: { code: 'invalid-source', sourceId: input.sourceId, reason: invalidSourceReason },
        };
    }
    if (input.notes.length === 0) {
        return { ok: false, error: { code: 'empty-source', sourceId: input.sourceId } };
    }

    const canonicalNotes = [...input.notes].sort(compareSourceNotes);
    const slotCount = getGrooveSubdivisionSlotCount(subdivision);
    const timingBySlot = new Map<number, number[]>();
    const dynamicsBySlot = new Map<number, number[]>();
    const meanVelocity = calculateStableMean(canonicalNotes.map((note) => note.velocity));

    for (const note of canonicalNotes) {
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
                timingOffset: calculateStableMean(timings),
                dynamicsOffset: calculateStableMean(dynamics),
            };
        });
    if (slots.every((slot) => Math.abs(slot.timingOffset) < 1e-9 && Math.abs(slot.dynamicsOffset) < 1e-9)) {
        return { ok: true, template: createStraightGrooveTemplate() };
    }

    const requestedTemplateId = input.templateId?.trim();
    return {
        ok: true,
        template: {
            id:
                requestedTemplateId && requestedTemplateId !== STRAIGHT_GROOVE_TEMPLATE_ID
                    ? requestedTemplateId
                    : `groove-${input.sourceId}-v${input.analyzerVersion}`,
            name: `${input.sourceName.trim()} groove`,
            schemaVersion: GROOVE_TEMPLATE_SCHEMA_VERSION,
            subdivision,
            slots,
            provenance: { type: 'midi-clip', sourceId: input.sourceId, analyzerVersion: input.analyzerVersion },
        },
    };
}
