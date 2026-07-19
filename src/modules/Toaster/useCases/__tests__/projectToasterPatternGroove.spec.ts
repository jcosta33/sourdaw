import { beforeEach, describe, expect, it } from 'vitest';

import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate, getStraightGrooveTemplateId } from '#/modules/MIDI/useCases';

import { projectToasterPatternGroove } from '../projectToasterPatternGroove';

const events = [{ id: 'step-1', startBeat: 0.25, velocity: 100 }];

describe('projectToasterPatternGroove', () => {
    beforeEach(() => grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState)));

    it('treats Straight as a bit-identical no-op regardless of the pattern subdivision', () => {
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:device-1:A1',
            templateId: getStraightGrooveTemplateId(),
            amount: 1,
        });

        const result = projectToasterPatternGroove({
            deviceId: 'device-1',
            patternId: 'A1',
            stepsPerBar: 32,
            events,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.events).toBe(events);
        }
    });

    it('treats amount zero as a bit-identical no-op before capability checks', () => {
        createGrooveTemplate({
            id: 'unsupported-eighth',
            name: 'Unsupported eighth',
            subdivision: '1/8',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: 0.1 }],
            provenance: { type: 'user', sourceId: 'amount-zero-test' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:device-1:A1',
            templateId: 'unsupported-eighth',
            amount: 0,
        });

        const result = projectToasterPatternGroove({
            deviceId: 'device-1',
            patternId: 'A1',
            stepsPerBar: 16,
            events,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.events).toBe(events);
        }
    });
});
