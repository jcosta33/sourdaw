import { describe, expect, it } from 'vitest';

import { readExportPcmBlock } from '../readExportPcmBlock';

describe('readExportPcmBlock', () => {
    it('borrows the exact logical window without copying or reading backing history', () => {
        const backing = new Float32Array([99, 1, 2, 3, 88]);
        const source = {
            sampleRate: 48000,
            numberOfChannels: 1,
            length: 3,
            getChannelData: () => backing.subarray(1, 4),
        };
        const [block] = readExportPcmBlock({ source, start: 1, length: 2 });
        expect(block!.buffer).toBe(backing.buffer);
        expect(Array.from(block!)).toEqual([2, 3]);
        expect(() => readExportPcmBlock({ source, start: 2, length: 2 })).toThrow(/window/i);
        expect(Array.from(backing)).toEqual([99, 1, 2, 3, 88]);
    });
    it('rejects a provider that substitutes missing channels or frames', () => {
        const source = {
            sampleRate: 48000,
            numberOfChannels: 2,
            length: 10,
            readChannels: () => [new Float32Array(1)],
        };
        expect(() => readExportPcmBlock({ source, start: 0, length: 4 })).toThrow(/PCM/i);
    });
    it('keeps prototype PCM methods bound to their original receiver', () => {
        class Source {
            readonly sampleRate = 48000;
            readonly numberOfChannels = 1;
            readonly length = 3;
            readonly samples = new Float32Array([1, 2, 3]);
            getChannelData() {
                return this.samples;
            }
        }
        const source = new Source();
        expect(Array.from(readExportPcmBlock({ source, start: 1, length: 2 })[0]!)).toEqual([2, 3]);
    });
});
