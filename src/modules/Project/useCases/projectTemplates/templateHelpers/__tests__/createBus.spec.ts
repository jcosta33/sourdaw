import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createTrack: vi.fn(() => ({ id: 'bus-1', name: '', kind: 'bus', devices: [], color: '#fff', gain: 0 })),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({ createTrack: mocks.createTrack }));

import { createBus } from '../createBus';

describe('createBus', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a bus track and maps devices through buildDevice', () => {
        const bus = createBus({
            name: 'Reverb Bus',
            devices: [{ type: 'builtin-reverb', name: 'Hall', params: { size: 0.8 } }, { type: 'builtin-eq' }],
        });
        expect(mocks.createTrack).toHaveBeenCalledExactlyOnceWith({ name: 'Reverb Bus', kind: 'bus' });
        expect(bus.devices).toHaveLength(2);
        expect(bus.devices[0]?.type).toBe('builtin-reverb');
        expect(bus.devices[1]?.name).toBe('builtin-eq');
    });

    it('applies color and gain overrides when provided', () => {
        const bus = createBus({ name: 'X', devices: [], color: '#f00', gain: -3 });
        expect(bus.color).toBe('#f00');
        expect(bus.gain).toBe(-3);
    });

    it('leaves color/gain unchanged when overrides omitted', () => {
        const bus = createBus({ name: 'X', devices: [] });
        expect(bus.color).toBe('#fff');
        expect(bus.gain).toBe(0);
    });
});
