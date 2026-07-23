import { describe, expect, it, vi } from 'vitest';

import { getToasterSwingOffsetBeats } from '../toasterSwingProjection';

const toaster = { id: 'toaster-1', type: 'toaster', parameterValues: { swing: 0.08 } };
const lane = {
    id: 'swing-lane',
    trackId: 'toaster-track',
    parameterId: 'toaster-1:swing',
    enabled: true,
};

describe('getToasterSwingOffsetBeats', () => {
    it('delays odd sixteenths from canonical parent automation', () => {
        const evaluateAutomationValue = vi.fn(() => 0.4);

        const offset = getToasterSwingOffsetBeats({
            parentTrackId: 'toaster-track',
            automationMode: 'read',
            devices: [toaster],
            lanes: [lane],
            noteStartBeat: 1.25,
            evaluateAutomationValue,
        });

        expect(offset).toBeCloseTo(0.05, 10);
        expect(evaluateAutomationValue).toHaveBeenCalledWith('swing-lane', 1.25);
    });

    it('does not reswing even sixteenths, static kit values, disabled lanes, or automation-off tracks', () => {
        const evaluateAutomationValue = vi.fn(() => 0.8);
        const input = {
            parentTrackId: 'toaster-track',
            automationMode: 'read',
            devices: [toaster],
            lanes: [lane],
            noteStartBeat: 1.25,
            evaluateAutomationValue,
        };

        expect(getToasterSwingOffsetBeats({ ...input, noteStartBeat: 1 })).toBe(0);
        expect(getToasterSwingOffsetBeats({ ...input, lanes: [] })).toBe(0);
        expect(getToasterSwingOffsetBeats({ ...input, lanes: [{ ...lane, enabled: false }] })).toBe(0);
        expect(getToasterSwingOffsetBeats({ ...input, automationMode: 'off' })).toBe(0);
    });
});
