import { describe, it, expect, beforeEach } from 'vitest';

import { getGrooveOffsetAtBeat } from '#/modules/Arrangement/useCases/groove/applyGrooveTemplate';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';

describe('getGrooveOffsetAtBeat', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        createGrooveTemplate({
            id: 'swing',
            name: 'Swing',
            subdivision: '1/8',
            slots: [1, 3, 5, 7].map((index) => ({ index, timingOffset: 0.2, dynamicsOffset: 0 })),
            provenance: { type: 'user', sourceId: 'test' },
        });
        assignGrooveTemplate({
            consumerType: 'sequencer',
            consumerId: 'project',
            templateId: 'swing',
            amount: 1,
        });
    });

    it('should return 0 if no groove is active', () => {
        grooveTemplateStore.set({ ...grooveTemplateStore.value!, assignments: [] });
        expect(getGrooveOffsetAtBeat(0.5)).toBe(0);
    });

    it('should compute offset based on resolution and intensity', () => {
        // resolution 0.5. beat 0 is step 0, beat 0.5 is step 1.
        expect(getGrooveOffsetAtBeat(0)).toBe(0);
        expect(getGrooveOffsetAtBeat(0.5)).toBeCloseTo(0.1);
        expect(getGrooveOffsetAtBeat(1.0)).toBe(0);
        expect(getGrooveOffsetAtBeat(1.5)).toBeCloseTo(0.1);

        // Intensity 0.5
        assignGrooveTemplate({
            consumerType: 'sequencer',
            consumerId: 'project',
            templateId: 'swing',
            amount: 0.5,
        });
        expect(getGrooveOffsetAtBeat(0.5)).toBeCloseTo(0.05);
    });
});
