import { describe, expect, it } from 'vitest';

import { captureCommandTargetFingerprints } from '../captureCommandTargetFingerprints';

describe('captureCommandTargetFingerprints', () => {
    it('produces the same fingerprint when object keys have different enumeration order', () => {
        const first = {
            tracks: [
                {
                    id: 'track-1',
                    name: 'Vocal',
                    devices: [{ id: 'device-1', parameterValues: { threshold: -18 }, type: 'compressor' }],
                },
            ],
        };
        const second = {
            tracks: [
                {
                    devices: [{ type: 'compressor', parameterValues: { threshold: -18 }, id: 'device-1' }],
                    name: 'Vocal',
                    id: 'track-1',
                },
            ],
        };

        expect(captureCommandTargetFingerprints({ document: first, targetIds: ['track-1'] })).toEqual(
            captureCommandTargetFingerprints({ document: second, targetIds: ['track-1'] })
        );
    });
});
