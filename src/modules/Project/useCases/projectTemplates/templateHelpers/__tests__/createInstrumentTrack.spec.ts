import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createTrack: vi.fn(() => ({ id: 'track-1', name: '', kind: 'midi', devices: [], color: '#fff', gain: 0, pan: 0 })),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({ createTrack: mocks.createTrack }));

import { createInstrumentTrack } from '../createInstrumentTrack';

describe('createInstrumentTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates a midi track with the instrument as the first device', () => {
        const track = createInstrumentTrack({
            name: 'Piano',
            deviceType: 'builtin-synth',
            deviceName: 'Soft Keys',
        });
        expect(mocks.createTrack).toHaveBeenCalledExactlyOnceWith({ name: 'Piano', kind: 'midi', parentId: undefined });
        expect(track.devices[0]?.type).toBe('builtin-synth');
        expect(track.devices[0]?.name).toBe('Soft Keys');
    });

    it('defaults device name to the track name when deviceName is omitted', () => {
        const track = createInstrumentTrack({ name: 'Bass', deviceType: 'builtin-synth' });
        expect(track.devices[0]?.name).toBe('Bass');
    });

    it('appends extraDevices after the instrument', () => {
        const track = createInstrumentTrack({
            name: 'Vocal',
            deviceType: 'builtin-synth',
            extraDevices: [{ type: 'builtin-compressor', name: 'Comp' }],
        });
        expect(track.devices).toHaveLength(2);
        expect(track.devices[1]?.type).toBe('builtin-compressor');
    });

    it('applies color/gain/pan overrides when provided', () => {
        const track = createInstrumentTrack({
            name: 'X',
            deviceType: 'x',
            color: '#abc',
            gain: 0.5,
            pan: 0.25,
        });
        expect(track.color).toBe('#abc');
        expect(track.gain).toBe(0.5);
        expect(track.pan).toBe(0.25);
    });
});
