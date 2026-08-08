import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    get16LevelsTarget: vi.fn(),
    triggerToasterPad: vi.fn(),
    setPadParamImmediate: vi.fn(),
}));

vi.mock('../get16LevelsTarget', () => ({
    get16LevelsTarget: mocks.get16LevelsTarget,
}));

vi.mock('../triggerPad', () => ({
    triggerToasterPad: mocks.triggerToasterPad,
}));

vi.mock('../setPadParamImmediate', () => ({
    setPadParamImmediate: mocks.setPadParamImmediate,
}));

import { trigger16Level } from '../trigger16Level';

describe('trigger16Level', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('is a no-op when no 16-levels session is active', () => {
        mocks.get16LevelsTarget.mockReturnValue(null);

        trigger16Level(0, 'dev-1');

        expect(mocks.triggerToasterPad).not.toHaveBeenCalled();
        expect(mocks.setPadParamImmediate).not.toHaveBeenCalled();
    });

    it('velocity target: maps gridIndex to MIDI velocity 1–127', () => {
        mocks.get16LevelsTarget.mockReturnValue({ padIndex: 3, target: 'velocity' });

        trigger16Level(0, 'dev-1');
        // gridIndex 0 → normalized (0+1)/16 = 0.0625 → velocity round(0.0625*127) = 8.
        expect(mocks.triggerToasterPad).toHaveBeenCalledWith('dev-1', 3, 8);

        vi.clearAllMocks();
        mocks.get16LevelsTarget.mockReturnValue({ padIndex: 3, target: 'velocity' });

        trigger16Level(15, 'dev-1');
        // gridIndex 15 → normalized 16/16 = 1.0 → velocity 127.
        expect(mocks.triggerToasterPad).toHaveBeenCalledWith('dev-1', 3, 127);
    });

    it('tune target: sets tune param from -24 to +24 semitones, then triggers', () => {
        mocks.get16LevelsTarget.mockReturnValue({ padIndex: 5, target: 'tune' });

        trigger16Level(0, 'dev-1');
        // gridIndex 0 → normalized 0.0625 → tune = -24 + 0.0625 * 48 = -21.
        expect(mocks.setPadParamImmediate).toHaveBeenCalledWith({
            deviceId: 'dev-1',
            padIndex: 5,
            key: 'tune',
            value: -21,
        });
        // Then triggers the pad at full velocity.
        expect(mocks.triggerToasterPad).toHaveBeenCalledWith('dev-1', 5, 127);
    });

    it('decay target: sets decay param from 0 to 1, then triggers', () => {
        mocks.get16LevelsTarget.mockReturnValue({ padIndex: 2, target: 'decay' });

        trigger16Level(15, 'dev-1');
        // gridIndex 15 → normalized 1.0 → decay = 1.0.
        expect(mocks.setPadParamImmediate).toHaveBeenCalledWith({
            deviceId: 'dev-1',
            padIndex: 2,
            key: 'decay',
            value: 1,
        });
        expect(mocks.triggerToasterPad).toHaveBeenCalledWith('dev-1', 2, 127);
    });

    it('filter target: sets exponential cutoff from 20 Hz to 20 kHz, then triggers', () => {
        mocks.get16LevelsTarget.mockReturnValue({ padIndex: 1, target: 'filter' });

        trigger16Level(0, 'dev-1');
        // gridIndex 0 → normalized 0.0625 → freq = 20 * 1000^0.0625.
        const expectedLow = 20 * (20000 / 20) ** 0.0625;
        expect(mocks.setPadParamImmediate).toHaveBeenCalledWith({
            deviceId: 'dev-1',
            padIndex: 1,
            key: 'filterCutoff',
            value: expectedLow,
        });

        vi.clearAllMocks();
        mocks.get16LevelsTarget.mockReturnValue({ padIndex: 1, target: 'filter' });

        trigger16Level(15, 'dev-1');
        // gridIndex 15 → normalized 1.0 → freq = 20 * 1000^1 = 20000.
        expect(mocks.setPadParamImmediate).toHaveBeenCalledWith({
            deviceId: 'dev-1',
            padIndex: 1,
            key: 'filterCutoff',
            value: 20000,
        });
    });

    it('mid-grid velocity produces a proportional value', () => {
        mocks.get16LevelsTarget.mockReturnValue({ padIndex: 0, target: 'velocity' });

        trigger16Level(7, 'dev-1');
        // gridIndex 7 → normalized 8/16 = 0.5 → velocity round(0.5*127) = 64 (rounds).
        expect(mocks.triggerToasterPad).toHaveBeenCalledWith('dev-1', 0, 64);
    });
});
