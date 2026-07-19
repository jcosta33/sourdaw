import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';

import { createYeastRuntimeProjection } from '../createYeastRuntimeProjection';

describe('createYeastRuntimeProjection', () => {
    beforeEach(() => grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState)));

    it('adapts MIDI-owned template truth without persisting a Yeast-local template', () => {
        createGrooveTemplate({
            id: 'yeast-pocket',
            name: 'Yeast pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        assignGrooveTemplate({
            consumerType: 'yeast-processor',
            consumerId: 'groove-1',
            templateId: 'yeast-pocket',
            amount: 0.75,
        });

        const [projection] = createYeastRuntimeProjection([
            { id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false, params: {} },
        ]);

        expect(projection?.params).toEqual(
            expect.objectContaining({
                groove_amount: 0.75,
                groove_step_beats: 0.25,
                groove_slot_count: 16,
                groove_timing_1: 0.2,
                groove_dynamics_1: -0.1,
            })
        );
        expect(projection?.params).not.toHaveProperty('template');
    });
});
