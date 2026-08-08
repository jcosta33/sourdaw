import { describe, it, expect } from 'vitest';

import { describeDetectedKey } from '../describeDetectedKey';

describe('describeDetectedKey', () => {
    it('names the key and its confidence as a percentage', () => {
        expect(describeDetectedKey({ detected: true, key: 'C', mode: 'major', confidence: 0.935 })).toBe(
            'Detected key: C major (94% confidence)'
        );
    });

    it('rounds the confidence rather than truncating it', () => {
        expect(describeDetectedKey({ detected: true, key: 'F#', mode: 'minor', confidence: 0.716 })).toBe(
            'Detected key: F# minor (72% confidence)'
        );
    });

    it('names the runner-up when the reading is a close call', () => {
        expect(
            describeDetectedKey({
                detected: true,
                key: 'A',
                mode: 'minor',
                confidence: 0.788,
                alternative: { key: 'C', mode: 'major' },
            })
        ).toBe('Detected key: A minor (79% confidence), close call with C major');
    });

    it('never names a key when nothing was detected', () => {
        const message = describeDetectedKey({ detected: false });

        expect(message).toBe('No key detected: the audio is atonal or broadband');
        expect(message).not.toMatch(/confidence/);
    });

    it('distinguishes missing audio from atonal audio', () => {
        expect(describeDetectedKey(null)).toBe('Could not detect key: no audio to analyse');
    });
});
