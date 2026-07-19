import {
    getGrooveSubdivisionSlotCount,
    type GrooveSubdivision,
    type GrooveTemplate,
} from '../../models/GrooveTemplate';

type GrooveConsumer = 'yeast' | 'toaster' | 'arpeggiator' | 'sequencer';
type AdaptGrooveTemplateForConsumerInput = {
    consumer: GrooveConsumer;
    template: GrooveTemplate;
    supportsDynamics: boolean;
    supportedSubdivisions: readonly GrooveSubdivision[];
};

type AdaptGrooveTemplateForConsumerResult =
    | {
          ok: true;
          projection: {
              subdivision: GrooveSubdivision;
              timingOffsets: number[];
              dynamicsOffsets: number[];
          };
      }
    | { ok: false; error: { code: 'unsupported-dynamics'; consumer: GrooveConsumer } }
    | {
          ok: false;
          error: { code: 'unsupported-subdivision'; consumer: GrooveConsumer; subdivision: GrooveSubdivision };
      };

export function adaptGrooveTemplateForConsumer({
    consumer,
    template,
    supportsDynamics,
    supportedSubdivisions,
}: AdaptGrooveTemplateForConsumerInput): AdaptGrooveTemplateForConsumerResult {
    if (!supportedSubdivisions.includes(template.subdivision)) {
        return { ok: false, error: { code: 'unsupported-subdivision', consumer, subdivision: template.subdivision } };
    }
    if (!supportsDynamics && template.slots.some((slot) => slot.dynamicsOffset !== 0)) {
        return { ok: false, error: { code: 'unsupported-dynamics', consumer } };
    }
    const slotCount = getGrooveSubdivisionSlotCount(template.subdivision);
    const timingOffsets = Array.from({ length: slotCount }, () => 0);
    const dynamicsOffsets = Array.from({ length: slotCount }, () => 0);
    for (const slot of template.slots) {
        if (slot.index < slotCount) {
            timingOffsets[slot.index] = slot.timingOffset;
            dynamicsOffsets[slot.index] = slot.dynamicsOffset;
        }
    }
    return { ok: true, projection: { subdivision: template.subdivision, timingOffsets, dynamicsOffsets } };
}
