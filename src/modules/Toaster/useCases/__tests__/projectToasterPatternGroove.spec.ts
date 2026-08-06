import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGrooveStore, mockGetGrooveTemplate, mockApplyGroove, mockGetStatus } = vi.hoisted(() => ({
    mockGrooveStore: { value: { templates: [], assignments: [] } },
    mockGetGrooveTemplate: vi.fn(),
    mockApplyGroove: vi.fn(),
    mockGetStatus: vi.fn(),
}));

vi.mock('#/modules/MIDI/stores', () => ({ grooveTemplateStore: mockGrooveStore }));
vi.mock('#/modules/MIDI/useCases', () => ({
    applyGrooveTemplate: mockApplyGroove,
    getGrooveTemplate: mockGetGrooveTemplate,
}));
vi.mock('../getToasterPatternGrooveStatus', () => ({
    getToasterPatternGrooveStatus: mockGetStatus,
}));

import { projectToasterPatternGroove } from '../projectToasterPatternGroove';

const events = [{ id: 'n1', startBeat: 0, velocity: 100 }];

describe('projectToasterPatternGroove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns events unchanged when status is unassigned', () => {
        mockGetStatus.mockReturnValue({ status: 'unassigned' });
        const result = projectToasterPatternGroove({
            deviceId: 'd1',
            patternId: 'p1',
            stepsPerBar: 16,
            events,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.events).toBe(events);
            expect(result.status.status).toBe('unassigned');
        }
        expect(mockGetGrooveTemplate).not.toHaveBeenCalled();
    });

    it('returns ok=false when status is not unassigned or ready', () => {
        mockGetStatus.mockReturnValue({ status: 'state-unavailable' });
        const result = projectToasterPatternGroove({
            deviceId: 'd1',
            patternId: 'p1',
            stepsPerBar: 16,
            events,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status.status).toBe('state-unavailable');
        }
    });

    it('returns ok=false when the template is not found after ready status', () => {
        mockGetStatus.mockReturnValue({
            status: 'ready',
            templateId: 'swing-light',
            templateName: 'Light Swing',
            amount: 0.5,
        });
        mockGetGrooveTemplate.mockReturnValue(undefined);
        const result = projectToasterPatternGroove({
            deviceId: 'd1',
            patternId: 'p1',
            stepsPerBar: 16,
            events,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.status.status).toBe('missing-template');
        }
    });

    it('applies the groove template and returns transformed events on success', () => {
        const template = { id: 'swing-light', name: 'Light Swing' };
        const transformed = [{ id: 'n1', startBeat: 0.03, velocity: 90 }];
        mockGetStatus.mockReturnValue({
            status: 'ready',
            templateId: 'swing-light',
            templateName: 'Light Swing',
            amount: 0.5,
        });
        mockGetGrooveTemplate.mockReturnValue(template);
        mockApplyGroove.mockReturnValue(transformed);
        const result = projectToasterPatternGroove({
            deviceId: 'd1',
            patternId: 'p1',
            stepsPerBar: 16,
            events,
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.events).toBe(transformed);
        }
        expect(mockApplyGroove).toHaveBeenCalledWith({ events, template, amount: 0.5 });
    });
});
