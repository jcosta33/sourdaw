import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../engineAccess/getAudioContext', () => ({
    getAudioContext: vi.fn(() => ({ sampleRate: 48000 })),
}));

import { getAudioContext } from '../../../engineAccess/getAudioContext';
import { clearAllReportedLatency, externalLatencyRegistry } from '../externalLatencyRegistry';
import { reportPluginLatencySamples } from '../reportPluginLatencySamples';

const mockGetAudioContext = getAudioContext as unknown as ReturnType<typeof vi.fn>;

describe('reportPluginLatencySamples', () => {
    beforeEach(() => {
        clearAllReportedLatency();
        mockGetAudioContext.mockReturnValue({ sampleRate: 48000 });
    });

    it('converts CLAP latency samples to milliseconds at the context sample rate', () => {
        reportPluginLatencySamples('device-1', 480);
        // 480 samples / 48000 Hz = 10 ms.
        expect(externalLatencyRegistry.get('device-1')).toBe(10);
    });

    it('reports zero latency samples as zero milliseconds', () => {
        reportPluginLatencySamples('device-2', 0);
        expect(externalLatencyRegistry.get('device-2')).toBe(0);
    });

    it('falls back to 48kHz when the context exposes no sample rate', () => {
        mockGetAudioContext.mockReturnValue({});
        reportPluginLatencySamples('device-3', 4800);
        // 4800 / 48000 = 100 ms via the fallback rate.
        expect(externalLatencyRegistry.get('device-3')).toBe(100);
    });
});
