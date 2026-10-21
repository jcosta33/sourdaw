import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createIncrementalMd5 } from '../createIncrementalMd5';

describe('incremental FLAC PCM MD5', () => {
    it('matches RFC1321 padding boundaries without retaining an input message', () => {
        for (const length of [0, 1, 55, 56, 63, 64, 65, 120, 127, 128, 129]) {
            const bytes = Uint8Array.from({ length }, (_, index) => index & 255);
            const md5 = createIncrementalMd5();
            for (let start = 0; start < length; start += 7) {
                md5.update(bytes.subarray(start, start + 7));
            }
            expect(Buffer.from(md5.digest()).toString('hex')).toBe(createHash('md5').update(bytes).digest('hex'));
        }
    });
    it('includes the high 32 bits of the bit count after crossing 512 MiB', () => {
        const chunk = new Uint8Array(1024 * 1024).fill(0x61);
        const reference = createHash('md5');
        const actual = createIncrementalMd5();
        for (let block = 0; block < 513; block++) {
            reference.update(chunk);
            actual.update(chunk);
        }
        expect(Buffer.from(actual.digest()).toString('hex')).toBe(reference.digest('hex'));
    }, 60000);
});
