import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate, getScopedGrooveConsumerId } from '#/modules/MIDI/useCases';

import { createYeastRuntimeProjection } from '../createYeastRuntimeProjection';

describe('createYeastRuntimeProjection', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('resolves assignments and templates from an explicit groove source', () => {
        createGrooveTemplate({
            id: 'alternate',
            name: 'Alternate',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.3, dynamicsOffset: -0.2 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        assignGrooveTemplate({
            consumerType: 'yeast-processor',
            consumerId: getScopedGrooveConsumerId({ ownerId: 'yeast-rack', localId: 'groove-1' }),
            templateId: 'alternate',
            amount: 0.8,
        });
        const source = structuredClone(grooveTemplateStore.value ?? defaultGrooveTemplateState);
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        const [projection] = createYeastRuntimeProjection(
            [{ id: 'groove-1', type: 'groove', name: 'Groove', bypassed: false, params: {} }],
            source
        );
        expect(projection?.params).toMatchObject({ groove_amount: 0.8, groove_timing_1: 0.3, groove_dynamics_1: -0.2 });
        expect(grooveTemplateStore.value?.assignments).toEqual([]);
    });

    it('should adapt MIDI-owned template truth without persisting a Yeast-local template', () => {
        createGrooveTemplate({
            id: 'yeast-pocket',
            name: 'Yeast pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        assignGrooveTemplate({
            consumerType: 'yeast-processor',
            consumerId: getScopedGrooveConsumerId({ ownerId: 'yeast-rack', localId: 'groove-1' }),
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
        expect(projection?.params).not.toHaveProperty('amount');
    });
});
