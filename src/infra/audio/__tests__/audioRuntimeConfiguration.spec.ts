import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('audioRuntimeConfiguration', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('seals the low-latency default when AudioEngine consumes it before app configuration', async () => {
        const { audioRuntimeConfiguration } = await import('../audioRuntimeConfiguration');

        expect(audioRuntimeConfiguration.latencyProfile).toBe('low-latency');
        expect(() => audioRuntimeConfiguration.configureLatencyProfile('high-capacity')).toThrow(
            'Audio latency profile is already configured'
        );
    });

    it('returns an explicitly configured profile and permits an idempotent repeat', async () => {
        const { audioRuntimeConfiguration } = await import('../audioRuntimeConfiguration');

        audioRuntimeConfiguration.configureLatencyProfile('high-capacity');
        audioRuntimeConfiguration.configureLatencyProfile('high-capacity');

        expect(audioRuntimeConfiguration.latencyProfile).toBe('high-capacity');
    });
});
