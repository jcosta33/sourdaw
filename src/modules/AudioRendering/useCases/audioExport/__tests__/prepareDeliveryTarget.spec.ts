import { describe, expect, it } from 'vitest';

import { DELIVERY_PRESETS } from '../../../models/deliveryPresets';
import { readExportPcmBlock } from '../../../repositories/audioEncoders/readExportPcmBlock';
import { resolveDeliveryTargets } from '../../resolveDeliveryTargets';
import { prepareDeliveryTarget } from '../prepareDeliveryTarget';

function fixture() {
    const samples = Float32Array.from(
        { length: 96000 },
        (_, frame) => 0.1 * Math.sin((2 * Math.PI * 1000 * frame) / 48000)
    );
    return {
        samples,
        source: { length: samples.length, numberOfChannels: 2, sampleRate: 48000, getChannelData: () => samples },
    };
}
function target(lufs: number, channels: 1 | 2 = 2) {
    return resolveDeliveryTargets({
        targets: [
            {
                id: 'target',
                name: 'Target',
                settings: { ...DELIVERY_PRESETS[2]!.settings, sampleRate: 44100, channels, targetLufs: lufs },
                dither: { mode: 'none' },
            },
        ],
    })[0]!;
}

describe('prepareDeliveryTarget', () => {
    it('drives the existing law independently for each converted target without rewriting original PCM', async () => {
        const { source, samples } = fixture();
        const before = samples.slice();
        const a = await prepareDeliveryTarget({ source, target: target(-14), checkCancelled: () => {} });
        const b = await prepareDeliveryTarget({ source, target: target(-20), checkCancelled: () => {} });
        expect(a.source.sampleRate).toBe(44100);
        expect(a.normalization?.measuredLufs).not.toBeNull();
        expect(20 * Math.log10(a.source.gain! / b.source.gain!)).toBeCloseTo(6, 5);
        expect(a.normalization!.measuredLufs! + 20 * Math.log10(a.normalization!.appliedGain)).toBeCloseTo(-14, 5);
        expect(samples).toEqual(before);
        expect(readExportPcmBlock({ source: a.source, start: 100, length: 100 })[0]!.length).toBe(100);
    });
    it('meters the mono conversion itself and preserves the silence unity law', async () => {
        const { source, samples } = fixture();
        const right = Float32Array.from(samples, (value) => -value);
        const antiphase = { ...source, getChannelData: (channel: number) => (channel === 0 ? samples : right) };
        const mono = await prepareDeliveryTarget({
            source: antiphase,
            target: target(-14, 1),
            checkCancelled: () => {},
        });
        expect(mono.normalization?.measuredLufs).toBeNull();
        expect(mono.source.gain).toBe(1);
        expect(mono.source.samplePeak).toBe(0);
    });
    it('yields and cancels during preprocessing instead of entering the next target', async () => {
        const { source } = fixture();
        let cancelled = false;
        const task = prepareDeliveryTarget({
            source,
            target: target(-14),
            checkCancelled: () => {
                if (cancelled) throw new Error('Export cancelled');
            },
        });
        setTimeout(() => {
            cancelled = true;
        }, 0);
        await expect(task).rejects.toThrow('Export cancelled');
    });
});
