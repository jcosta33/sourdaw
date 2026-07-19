import { describe, expect, it } from 'vitest';

import { loadGrinderProcessorConstructor } from './grinderProcessorTestHarness';

describe('grinderAudioParamDescriptors', () => {
    it('publishes exactly the canonical continuous Grinder contract', async () => {
        const Processor = await loadGrinderProcessorConstructor();

        expect(Processor.parameterDescriptors).toEqual([
            { name: 'gain', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'a-rate' },
            { name: 'bass', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'a-rate' },
            { name: 'mid', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'a-rate' },
            { name: 'treble', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'a-rate' },
            { name: 'presence', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'a-rate' },
            { name: 'resonance', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'a-rate' },
            { name: 'master', defaultValue: 5, minValue: 0, maxValue: 10, automationRate: 'a-rate' },
            { name: 'inputGain', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'a-rate' },
            { name: 'outputGain', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'a-rate' },
            { name: 'transformerDrive', defaultValue: 0.3, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
            { name: 'negFeedback', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
        ]);
    });
});
