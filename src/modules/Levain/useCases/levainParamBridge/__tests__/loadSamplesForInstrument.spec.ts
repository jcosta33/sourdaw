import { describe, it, expect, vi, beforeEach } from 'vitest';

const bridge = {
    loadSamplesForInstrument: vi.fn(),
};

vi.mock('../levainBridge', () => ({
    levainBridge: () => bridge,
}));

import { loadSamplesForInstrument } from '../loadSamplesForInstrument';

describe('loadSamplesForInstrument', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards deviceId and instrumentId to the bridge', () => {
        loadSamplesForInstrument('dev-1', 'cello');

        expect(bridge.loadSamplesForInstrument).toHaveBeenCalledTimes(1);
        expect(bridge.loadSamplesForInstrument).toHaveBeenCalledWith('dev-1', 'cello');
    });
});
