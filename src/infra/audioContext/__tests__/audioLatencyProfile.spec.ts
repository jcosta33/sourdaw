import { stringify } from 'superjson';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAudioContextLatencyHint, readStoredAudioLatencyProfile } from '../audioLatencyProfile';

describe('audioLatencyProfile', () => {
    afterEach(() => {
        window.localStorage.clear();
    });

    it('maps product profiles to the standard Chrome latency categories', () => {
        expect(getAudioContextLatencyHint('lowLatency')).toBe('interactive');
        expect(getAudioContextLatencyHint('highCapacity')).toBe('playback');
    });

    it('reads a valid startup profile from the existing preferences blob', () => {
        window.localStorage.setItem(
            'sourdaw-preferences',
            stringify({ preferencesSchemaVersion: 2, audioLatencyProfile: 'highCapacity' })
        );

        expect(readStoredAudioLatencyProfile()).toBe('highCapacity');
    });

    it.each([null, 'balanced', 512])('defaults an absent or invalid stored profile %s to low latency', (profile) => {
        window.localStorage.setItem(
            'sourdaw-preferences',
            stringify({ preferencesSchemaVersion: 2, audioLatencyProfile: profile })
        );

        expect(readStoredAudioLatencyProfile()).toBe('lowLatency');
    });

    it('defaults to low latency when browser storage is unavailable', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
            throw new DOMException('Storage is unavailable', 'SecurityError');
        });

        expect(readStoredAudioLatencyProfile()).toBe('lowLatency');
    });
});
