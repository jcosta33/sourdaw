import { describe, it, expect, beforeEach } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';

import { projectSequencerGroove } from '../applyGrooveTemplate';

describe('projectSequencerGroove', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        createGrooveTemplate({
            id: 'swing',
            name: 'Swing',
            subdivision: '1/8',
            slots: [1, 3, 5, 7].map((index) => ({ index, timingOffset: 0.2, dynamicsOffset: 0.2 })),
            provenance: { type: 'user', sourceId: 'test' },
        });
        assignGrooveTemplate({
            consumerType: 'sequencer',
            consumerId: 'project',
            templateId: 'swing',
            amount: 1,
        });
    });

    it('returns the complete event unchanged if no groove is active', () => {
        grooveTemplateStore.set({ ...grooveTemplateStore.value!, assignments: [] });
        const event = { id: 'note-1', startBeat: 0.5, velocity: 80, pitch: 60 };

        expect(projectSequencerGroove(event)).toBe(event);
    });

    it('projects timing and dynamics based on resolution and intensity', () => {
        // resolution 0.5. beat 0 is step 0, beat 0.5 is step 1.
        expect(projectSequencerGroove({ id: 'a', startBeat: 0, velocity: 80 })).toEqual({
            id: 'a',
            startBeat: 0,
            velocity: 80,
        });
        expect(projectSequencerGroove({ id: 'b', startBeat: 0.5, velocity: 80 })).toEqual({
            id: 'b',
            startBeat: 0.6,
            velocity: 105,
        });

        // Intensity 0.5
        assignGrooveTemplate({
            consumerType: 'sequencer',
            consumerId: 'project',
            templateId: 'swing',
            amount: 0.5,
        });
        expect(projectSequencerGroove({ id: 'c', startBeat: 0.5, velocity: 80 })).toEqual({
            id: 'c',
            startBeat: 0.55,
            velocity: 93,
        });
    });
});
