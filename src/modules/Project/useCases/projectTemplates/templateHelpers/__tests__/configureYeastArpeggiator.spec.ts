import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    setActiveYeastDevice: vi.fn(),
    addYeastProcessor: vi.fn(),
    setYeastProcessorParam: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/Yeast/stores', () => ({ setActiveYeastDevice: mocks.setActiveYeastDevice }));
vi.mock('#/modules/Yeast/useCases', () => ({
    addYeastProcessor: mocks.addYeastProcessor,
    setYeastProcessorParam: mocks.setYeastProcessorParam,
}));

import { type Track } from '#/modules/Arrangement/stores';

import { configureYeastArpeggiator } from '../configureYeastArpeggiator';

function makeTrack(devices: Track['devices']): Track {
    return {
        id: 't1',
        name: 'Arp',
        kind: 'midi',
        devices,
    } as unknown as Track;
}

const YEAST_DEVICE = { id: 'dev-yeast', name: 'Arpeggiator', type: 'yeast', bypassed: false, parameterValues: {} };

describe('configureYeastArpeggiator', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.setYeastProcessorParam.mockResolvedValue(undefined);
    });

    it('adds one arpeggiator processor to the track yeast device rack and writes the arp values through the rack write path', async () => {
        await configureYeastArpeggiator({
            track: makeTrack([YEAST_DEVICE]),
            processorId: 'arpeggiator-edm-arp',
            mode: 2,
            rateDenominator: 16,
            gate: 0.7,
            swing: 0.1,
        });

        expect(mocks.addYeastProcessor).toHaveBeenCalledExactlyOnceWith(
            'arpeggiator',
            'arpeggiator-edm-arp',
            'Arpeggiator'
        );
        // The rack processor's own param arms, not device-parameter ids.
        expect(mocks.setYeastProcessorParam.mock.calls).toEqual([
            ['arpeggiator-edm-arp', 'mode', 2],
            ['arpeggiator-edm-arp', 'rate_denom', 16],
            ['arpeggiator-edm-arp', 'gate', 0.7],
            ['arpeggiator-edm-arp', 'swing', 0.1],
        ]);
    });

    it('pins the device rack for the whole configuration and unpins afterwards', async () => {
        await configureYeastArpeggiator({
            track: makeTrack([YEAST_DEVICE]),
            processorId: 'arpeggiator-edm-arp',
            mode: 0,
            rateDenominator: 8,
            gate: 0.8,
            swing: 0,
        });

        expect(mocks.setActiveYeastDevice.mock.calls).toEqual([['dev-yeast'], [null]]);
    });

    it('unpins even when a rack write fails', async () => {
        mocks.setYeastProcessorParam.mockRejectedValueOnce(new Error('projection push failed'));
        await expect(
            configureYeastArpeggiator({
                track: makeTrack([YEAST_DEVICE]),
                processorId: 'arpeggiator-edm-arp',
                mode: 0,
                rateDenominator: 8,
                gate: 0.8,
                swing: 0,
            })
        ).rejects.toThrow('projection push failed');

        expect(mocks.setActiveYeastDevice.mock.calls).toEqual([['dev-yeast'], [null]]);
    });

    it('throws when the track carries no Yeast device', async () => {
        await expect(
            configureYeastArpeggiator({
                track: makeTrack([
                    { id: 'dev-synth', name: 'Synth', type: 'builtin-synth', bypassed: false, parameterValues: {} },
                ]),
                processorId: 'arpeggiator-edm-arp',
                mode: 0,
                rateDenominator: 8,
                gate: 0.8,
                swing: 0,
            })
        ).rejects.toThrow('carries no Yeast device');

        expect(mocks.addYeastProcessor).not.toHaveBeenCalled();
        expect(mocks.setActiveYeastDevice).not.toHaveBeenCalled();
    });
});
