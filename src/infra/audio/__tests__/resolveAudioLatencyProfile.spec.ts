import { describe, expect, it } from 'vitest';

import { resolveAudioLatencyProfile } from '../resolveAudioLatencyProfile';

describe('resolveAudioLatencyProfile', () => {
    it('uses a valid URL override instead of the persisted preference', () => {
        expect(
            resolveAudioLatencyProfile({
                requestedProfile: 'high-capacity',
                persistedProfile: 'low-latency',
            })
        ).toBe('high-capacity');
    });

    it('falls back to the persisted preference when the URL override is invalid', () => {
        expect(
            resolveAudioLatencyProfile({
                requestedProfile: 'unsupported',
                persistedProfile: 'high-capacity',
            })
        ).toBe('high-capacity');
    });

    it('uses the low-latency default when neither input is valid', () => {
        expect(
            resolveAudioLatencyProfile({
                requestedProfile: null,
                persistedProfile: undefined,
            })
        ).toBe('low-latency');
    });
});
