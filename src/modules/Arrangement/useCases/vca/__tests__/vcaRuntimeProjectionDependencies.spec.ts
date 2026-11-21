import { describe, expect, it, vi } from 'vitest';

import {
    setVcaRuntimeProjectionDependencies,
    vcaRuntimeProjectionDependencies,
} from '../vcaRuntimeProjectionDependencies';

describe('vcaRuntimeProjectionDependencies', () => {
    it('refuses to read before registration and names the registrar', () => {
        expect(() => vcaRuntimeProjectionDependencies.read('probe')).toThrow(
            /probe: .*call setVcaRuntimeProjectionDependencies\(\) from #\/app\/bootstrap/
        );
    });

    it('returns what was filled and lets a second fill replace it', () => {
        const first = { reconcileVcaRuntimeGain: vi.fn() };
        const second = { reconcileVcaRuntimeGain: vi.fn() };

        setVcaRuntimeProjectionDependencies(first);
        expect(vcaRuntimeProjectionDependencies.read('probe')).toBe(first);

        setVcaRuntimeProjectionDependencies(second);
        expect(vcaRuntimeProjectionDependencies.read('probe')).toBe(second);
    });
});
