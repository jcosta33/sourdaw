import { describe, expect, it, vi } from 'vitest';

import { type AdjustmentLayer } from '#/modules/Arrangement/stores';
import { dbToGain } from '#/utils/audioLevelLaw';

import { resolveTrackAdjustmentComposition } from '../offlineAdjustmentLayers';
import { scheduleOfflineAdjustmentCurves } from '../scheduleOfflineAdjustmentCurves';

describe('moving adjustment output follows the anchored tempo projection', () => {
    const layer: AdjustmentLayer = {
        id: 'layer',
        name: 'Fade',
        effectType: 'volume',
        enabled: true,
        mix: 1,
        parameters: [{ name: 'Gain', value: -12, min: -60, max: 12, unit: 'dB' }],
        affectedTrackIds: ['track'],
        insertionIndex: 0,
        color: 'red',
        regions: [{ id: 'fade', startBeat: 4, endBeat: 8, blend: 1, fadeInBeats: 4, fadeOutBeats: 0 }],
    };
    const panLayer: AdjustmentLayer = {
        ...layer,
        id: 'pan',
        effectType: 'pan',
        parameters: [{ name: 'Pan', value: 100, min: -100, max: 100, unit: '%' }],
    };
    const layers = [layer, panLayer];
    const tickSeconds = 4.8 * Math.log(175 / 150);

    it('emits gain/pan at beats 4 and 6, retaining the compensated seed and write times', () => {
        const gain = { setValueAtTime: vi.fn() } as unknown as AudioParam;
        const pan = { setValueAtTime: vi.fn() } as unknown as AudioParam;
        const input = {
            layers,
            trackId: 'track',
            allTrackIds: ['track'],
            composition: resolveTrackAdjustmentComposition({
                layers,
                trackId: 'track',
                allTrackIds: ['track'],
                spanStartBeat: 4,
                spanEndBeat: 8,
            }),
            trackGainNode: { gain },
            trackPanNode: { pan },
            baseGain: 0.8,
            basePan: 0,
            vcaMultiplier: 0.5,
            durationSeconds: tickSeconds * 1.5,
            regionStartBeat: 4,
            tickSeconds,
            projectSecondsToBeat: (seconds: number) => (150 * Math.exp(seconds / 4.8) - 100) / 12.5,
            compensationDelaySec: 0.125,
        };
        scheduleOfflineAdjustmentCurves(input);
        expect(gain.setValueAtTime).toHaveBeenCalledWith(0.4, 0);
        expect(pan.setValueAtTime).toHaveBeenCalledWith(0, 0);
        const gainCalls = vi.mocked(gain.setValueAtTime).mock.calls;
        expect(gainCalls.at(-1)?.[0]).toBeCloseTo(0.4 * (1 + (dbToGain(-12) - 1) * 0.5), 10);
        expect(gainCalls.at(-1)?.[1]).toBeCloseTo(tickSeconds + 0.125, 10);
        const panCalls = vi.mocked(pan.setValueAtTime).mock.calls;
        expect(panCalls.at(-1)?.[0]).toBeCloseTo(0.5, 10);
        expect(panCalls.at(-1)?.[1]).toBeCloseTo(tickSeconds + 0.125, 10);
    });

    it('leaves a constant composition seed alone', () => {
        const gain = { setValueAtTime: vi.fn() } as unknown as AudioParam;
        const pan = { setValueAtTime: vi.fn() } as unknown as AudioParam;
        const input = {
            layers: [],
            trackId: 'track',
            allTrackIds: ['track'],
            composition: { gainMultiplier: 1, panOffset: 0, dsp: [], constant: true },
            trackGainNode: { gain },
            trackPanNode: { pan },
            baseGain: 0.8,
            basePan: 0,
            vcaMultiplier: 1,
            durationSeconds: 1,
            regionStartBeat: 4,
            tickSeconds,
            projectSecondsToBeat: vi.fn(() => 4),
            compensationDelaySec: 0,
        };
        scheduleOfflineAdjustmentCurves(input);
        expect(input.projectSecondsToBeat).not.toHaveBeenCalled();
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });

    it('refuses a moving layer with no inverse projection', () => {
        const gain = { setValueAtTime: vi.fn() } as unknown as AudioParam;
        const pan = { setValueAtTime: vi.fn() } as unknown as AudioParam;
        expect(() =>
            scheduleOfflineAdjustmentCurves({
                layers,
                trackId: 'track',
                allTrackIds: ['track'],
                composition: { gainMultiplier: 1, panOffset: 0, dsp: [], constant: false },
                trackGainNode: { gain },
                trackPanNode: { pan },
                baseGain: 0.8,
                basePan: 0,
                vcaMultiplier: 1,
                durationSeconds: 1,
                regionStartBeat: 4,
                tickSeconds,
                compensationDelaySec: 0,
            })
        ).toThrow('Offline seconds-to-beat projection is not configured');
        expect(gain.setValueAtTime).not.toHaveBeenCalled();
        expect(pan.setValueAtTime).not.toHaveBeenCalled();
    });
});
