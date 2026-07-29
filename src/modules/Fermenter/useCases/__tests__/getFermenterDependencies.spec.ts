import { describe, it, expect, beforeEach } from 'vitest';

import { fermenterDependenciesHolder, setFermenterDependencies } from '../fermenterDependencies';
import { getFermenterDependencies } from '../getFermenterDependencies';

describe('getFermenterDependencies', () => {
    beforeEach(() => {
        // Reset to uninitialized between tests — the holder is module-singleton.
        fermenterDependenciesHolder.current = null;
    });

    it('throws when dependencies have not been initialized', () => {
        // Removing the guard (the if (!holder.current) throw) would make this
        // return null instead of throwing — the guard is load-bearing.
        expect(() => getFermenterDependencies()).toThrowError(/not initialized/);
    });

    it('returns the dependencies set via setFermenterDependencies', () => {
        const deps = {
            clampDeviceParameterValue: ({ value }: { value: number }) => value,
            persistDeviceParam: () => {},
            updateDeviceParam: () => {},
            getAllTracks: (() => []) as never,
            resolveEligibleDeviceWriteTarget: (() => ({ status: 'missing' as const })) as never,
        };
        setFermenterDependencies(deps);

        expect(getFermenterDependencies()).toBe(deps);
    });
});
