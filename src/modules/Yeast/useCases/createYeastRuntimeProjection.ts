import {
    adaptGrooveTemplateForConsumer,
    getGrooveAssignment,
    getGrooveTemplate,
    getStraightGrooveTemplateId,
} from '#/modules/MIDI/useCases';

import { createYeastProcessorProjection } from '../models/YeastProcessorProjection';

import type { YeastProcessorProjection } from '../models/YeastProcessorProjection';
import type { YeastProcessorInfo } from '../stores/yeastStore';

function getStepBeats(subdivision: string): number {
    switch (subdivision) {
        case '1/8':
            return 0.5;
        case '1/32':
            return 0.125;
        case '1/16T':
            return 1 / 6;
        default:
            return 0.25;
    }
}

export function createYeastRuntimeProjection(processors: readonly YeastProcessorInfo[]): YeastProcessorProjection {
    return createYeastProcessorProjection(processors).map((processor) => {
        if (processor.type !== 'groove') {
            return processor;
        }

        const assignment = getGrooveAssignment({
            consumerType: 'yeast-processor',
            consumerId: processor.id,
        });
        const template = getGrooveTemplate(assignment?.templateId ?? getStraightGrooveTemplateId());
        if (!template) {
            return processor;
        }
        const adaptation = adaptGrooveTemplateForConsumer({
            consumer: 'yeast',
            template,
            supportsDynamics: true,
            supportedSubdivisions: ['1/8', '1/16', '1/32', '1/16T'],
        });
        if (!adaptation.ok) {
            return processor;
        }

        const params: Record<string, number> = {
            ...processor.params,
            groove_amount: assignment?.amount ?? processor.params.amount ?? 0.5,
            groove_step_beats: getStepBeats(adaptation.projection.subdivision),
            groove_slot_count: adaptation.projection.timingOffsets.length,
        };
        delete params.template;
        delete params.amount;
        delete params.subdivision;
        for (let index = 0; index < adaptation.projection.timingOffsets.length; index++) {
            params[`groove_timing_${index}`] = adaptation.projection.timingOffsets[index] ?? 0;
            params[`groove_dynamics_${index}`] = adaptation.projection.dynamicsOffsets[index] ?? 0;
        }
        return { ...processor, params };
    });
}
