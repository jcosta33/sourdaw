import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assignGrooveTemplate: vi.fn(),
    createGrooveTemplate: vi.fn((input: Record<string, unknown>) => ({
        template: { ...input, id: input.id as string },
    })),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    assignGrooveTemplate: mocks.assignGrooveTemplate,
    createGrooveTemplate: mocks.createGrooveTemplate,
}));

import { setGroove } from '../setGroove';

describe('setGroove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a groove template and assigns it to the sequencer', () => {
        setGroove({
            id: 'test-groove',
            name: 'Test',
            offsets: [0, 0.12],
            resolution: 0.25,
            intensity: 0.5,
        });
        expect(mocks.createGrooveTemplate).toHaveBeenCalledTimes(1);
        expect(mocks.assignGrooveTemplate).toHaveBeenCalledExactlyOnceWith({
            consumerType: 'sequencer',
            consumerId: 'project',
            templateId: 'test-groove',
            amount: 0.5,
        });
    });

    it('selects the correct subdivision based on resolution', () => {
        // 1/16 subdivision (resolution 0.25)
        setGroove({ id: 'a', name: 'A', offsets: [0, 0.1], resolution: 0.25, intensity: 0.5 });
        const calls = mocks.createGrooveTemplate.mock.calls as Array<Array<Record<string, unknown>>>;
        expect(calls[0]?.[0]?.subdivision).toBe('1/16');

        // 1/8 subdivision (resolution 0.5)
        setGroove({ id: 'b', name: 'B', offsets: [0, 0.1], resolution: 0.5, intensity: 0.5 });
        expect(calls[1]?.[0]?.subdivision).toBe('1/8');

        // 1/32 subdivision (resolution 0.125)
        setGroove({ id: 'c', name: 'C', offsets: [0, 0.1], resolution: 0.125, intensity: 0.5 });
        expect(calls[2]?.[0]?.subdivision).toBe('1/32');
    });

    it('falls back to [0] when offsets array is empty', () => {
        setGroove({ id: 'x', name: 'X', offsets: [], resolution: 0.25, intensity: 0.5 });
        const calls = mocks.createGrooveTemplate.mock.calls as Array<Array<Record<string, unknown>>>;
        const slots = calls[0]?.[0]?.slots as Array<{ timingOffset: number }>;
        // With all-zero offsets, no slots should have non-zero timingOffset
        expect(slots.every((s) => s.timingOffset === 0)).toBe(true);
    });
});
