import { describe, expect, it } from 'vitest';

import { type GrinderPedal } from '../../../models/GrinderPatch';
import { getPedalOrderAudioEntries } from '../getPedalOrderAudioEntries';

describe('getPedalOrderAudioEntries', () => {
    it('should preserve supported chain order and append missing pedals', () => {
        const pedals = [
            { id: 'fuzz-1', type: 'fuzz', enabled: true, params: {} },
            { id: 'wah-1', type: 'wah', enabled: true, params: {} },
            { id: 'overdrive-1', type: 'overdrive', enabled: true, params: {} },
            { id: 'fuzz-2', type: 'fuzz', enabled: false, params: {} },
        ] satisfies GrinderPedal[];

        expect(getPedalOrderAudioEntries(false, pedals)).toEqual([
            { key: 'preCompressorOrder', value: 2 },
            { key: 'preOverdriveOrder', value: 1 },
            { key: 'preDistortionOrder', value: 3 },
            { key: 'preFuzzOrder', value: 0 },
        ]);
    });

    it('should emit post-chain order entries in supported default order when no pedals are present', () => {
        expect(getPedalOrderAudioEntries(true, [])).toEqual([
            { key: 'postCompressorOrder', value: 0 },
            { key: 'postOverdriveOrder', value: 1 },
            { key: 'postDistortionOrder', value: 2 },
            { key: 'postFuzzOrder', value: 3 },
        ]);
    });
});
