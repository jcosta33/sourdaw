import { createStraightGrooveTemplate, type GrooveTemplate, type GrooveTemplateSlot } from './GrooveTemplate';

type FactoryGrooveDefinition = {
    id: string;
    name: string;
    timingOffsets: readonly number[];
    dynamicsOffsets: readonly number[];
};

function createFactoryGrooveTemplate(definition: FactoryGrooveDefinition): GrooveTemplate {
    const slots: GrooveTemplateSlot[] = definition.timingOffsets.flatMap((timingOffset, index) => {
        const dynamicsOffset = definition.dynamicsOffsets[index] ?? 0;
        return timingOffset === 0 && dynamicsOffset === 0 ? [] : [{ index, timingOffset, dynamicsOffset }];
    });
    return {
        id: definition.id,
        name: definition.name,
        schemaVersion: 1,
        subdivision: '1/16',
        slots,
        provenance: { type: 'builtin', sourceId: `factory:${definition.id}` },
    };
}

export function createBuiltinGrooveTemplates(): GrooveTemplate[] {
    return [
        createStraightGrooveTemplate(),
        createFactoryGrooveTemplate({
            id: 'swing-light',
            name: 'Light Swing',
            timingOffsets: [0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12, 0, 0.12],
            dynamicsOffsets: [0, -0.3, -0.1, -0.3, 0, -0.3, -0.1, -0.3, 0, -0.3, -0.1, -0.3, 0, -0.3, -0.1, -0.3],
        }),
        createFactoryGrooveTemplate({
            id: 'swing-heavy',
            name: 'Heavy Swing',
            timingOffsets: [0, 0.32, 0, 0.32, 0, 0.32, 0, 0.32, 0, 0.32, 0, 0.32, 0, 0.32, 0, 0.32],
            dynamicsOffsets: [0, -0.4, -0.15, -0.4, 0, -0.4, -0.15, -0.4, 0, -0.4, -0.15, -0.4, 0, -0.4, -0.15, -0.4],
        }),
        createFactoryGrooveTemplate({
            id: 'mpc-60',
            name: 'MPC 60 Feel',
            timingOffsets: [0, 0.16, 0, 0.08, 0, 0.16, 0, 0.12, 0, 0.16, 0, 0.08, 0, 0.16, 0, 0.12],
            dynamicsOffsets: [
                0.15, -0.25, -0.1, -0.3, 0.1, -0.25, -0.15, -0.3, 0.15, -0.25, -0.1, -0.3, 0.1, -0.25, -0.15, -0.3,
            ],
        }),
        createFactoryGrooveTemplate({
            id: 'sp-1200',
            name: 'SP-1200 Feel',
            timingOffsets: [0, -0.12, 0, -0.04, 0, -0.12, 0, -0.08, 0, -0.12, 0, -0.04, 0, -0.12, 0, -0.08],
            dynamicsOffsets: [
                0.1, -0.2, -0.05, -0.2, 0.05, -0.2, -0.1, -0.2, 0.1, -0.2, -0.05, -0.2, 0.05, -0.2, -0.1, -0.2,
            ],
        }),
    ];
}
