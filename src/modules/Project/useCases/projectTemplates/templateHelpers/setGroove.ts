import { assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';

const SUBDIVISION_SLOT_COUNTS = { '1/8': 8, '1/16': 16, '1/32': 32 } as const;

type SetGrooveInput = {
    id: string;
    name: string;
    offsets: number[];
    resolution: number;
    intensity: number;
};

function getSubdivision(resolution: number): '1/8' | '1/16' | '1/32' {
    if (resolution === 0.5) {
        return '1/8';
    }
    if (resolution === 0.125) {
        return '1/32';
    }
    return '1/16';
}

export function setGroove(input: SetGrooveInput): void {
    const subdivision = getSubdivision(input.resolution);
    const slotCount = SUBDIVISION_SLOT_COUNTS[subdivision];
    const sourceOffsets = input.offsets.length > 0 ? input.offsets : [0];
    const slots: Array<{ index: number; timingOffset: number; dynamicsOffset: number }> = [];
    for (let index = 0; index < slotCount; index += 1) {
        const offset = sourceOffsets[index % sourceOffsets.length] ?? 0;
        if (offset === 0) {
            continue;
        }
        slots.push({ index, timingOffset: offset / input.resolution, dynamicsOffset: 0 });
    }
    const { template } = createGrooveTemplate({
        id: input.id,
        name: input.name,
        subdivision,
        slots,
        provenance: { type: 'builtin', sourceId: `project-template:${input.id}` },
    });
    assignGrooveTemplate({
        consumerType: 'sequencer',
        consumerId: 'project',
        templateId: template.id,
        amount: input.intensity,
    });
}
