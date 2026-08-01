import { describe, it, expect } from 'vitest';

import { classifyRenderSilence, type ClassifyRenderSilenceInput } from '../classifyRenderSilence';

const AUDIBLE = { id: 'audible' } as unknown as AudioBuffer;
const SILENT = { id: 'silent' } as unknown as AudioBuffer;

function evaluate(overrides: Partial<ClassifyRenderSilenceInput> = {}) {
    return classifyRenderSilence({
        scheduledNotes: 4,
        scheduledBuffers: [],
        isSilentSource: (buffer) => buffer === SILENT,
        bakedFaderGain: 1,
        bakesAutomation: false,
        hasAutomationLanes: false,
        ...overrides,
    });
}

describe('classifyRenderSilence', () => {
    it('calls silence unexpected when notes reached the graph', () => {
        expect(evaluate()).toEqual({ unexpected: true });
    });

    it('calls silence unexpected when an audible source reached the graph', () => {
        expect(evaluate({ scheduledNotes: 0, scheduledBuffers: [AUDIBLE] })).toEqual({ unexpected: true });
    });

    it('abstains when the scheduler put nothing into the graph', () => {
        expect(evaluate({ scheduledNotes: 0, scheduledBuffers: [] })).toEqual({
            unexpected: false,
            abstention: 'nothing-scheduled',
        });
    });

    it('abstains when every source the scheduler started is itself silent', () => {
        expect(evaluate({ scheduledNotes: 0, scheduledBuffers: [SILENT, SILENT] })).toEqual({
            unexpected: false,
            abstention: 'all-sources-silent',
        });
    });

    it('still refuses when one of several sources carries audio', () => {
        expect(evaluate({ scheduledNotes: 0, scheduledBuffers: [SILENT, AUDIBLE] })).toEqual({ unexpected: true });
    });

    it('does not excuse a silent source when notes were also scheduled', () => {
        expect(evaluate({ scheduledNotes: 2, scheduledBuffers: [SILENT] })).toEqual({ unexpected: true });
    });

    it('abstains when the render bakes a fader the user parked at zero', () => {
        expect(evaluate({ bakedFaderGain: 0 })).toEqual({ unexpected: false, abstention: 'fader-zeroed' });
    });

    it('abstains when the render bakes automation this guard does not model', () => {
        expect(evaluate({ bakesAutomation: true, hasAutomationLanes: true })).toEqual({
            unexpected: false,
            abstention: 'automation-not-modelled',
        });
    });

    it('does not abstain on automation the render is not baking', () => {
        expect(evaluate({ bakesAutomation: false, hasAutomationLanes: true })).toEqual({ unexpected: true });
    });

    it('does not abstain when the track carries no lanes to bake', () => {
        expect(evaluate({ bakesAutomation: true, hasAutomationLanes: false })).toEqual({ unexpected: true });
    });

    it('leaves the source scan unasked when nothing excuses the render', () => {
        let scans = 0;
        classifyRenderSilence({
            scheduledNotes: 1,
            scheduledBuffers: [SILENT],
            isSilentSource: (buffer) => {
                scans++;
                return buffer === SILENT;
            },
            bakedFaderGain: 1,
            bakesAutomation: false,
            hasAutomationLanes: false,
        });
        // Notes were scheduled, so no reading of source samples can change the
        // verdict — the expensive question is never asked.
        expect(scans).toBe(0);
    });
});
