import { afterEach, describe, expect, it } from 'vitest';

import { fermenterDependenciesHolder, setFermenterDependencies } from '../fermenterDependencies';

import type { FermenterDependencies } from '../fermenterDependencies';

function makeDeps(overrides?: Partial<FermenterDependencies>): FermenterDependencies {
    return {
        clampDeviceParameterValue: () => 0,
        persistDeviceParam: () => undefined,
        updateDeviceParam: () => undefined,
        getAllTracks: () => [],
        resolveEligibleDeviceWriteTarget: () => ({ status: 'missing' }),
        ...overrides,
    };
}

describe('fermenterDependenciesHolder', () => {
    afterEach(() => {
        fermenterDependenciesHolder.current = null;
    });

    it('starts as null (not yet injected)', () => {
        expect(fermenterDependenciesHolder.current).toBeNull();
    });

    it('setFermenterDependencies stores the dependency object', () => {
        const deps = makeDeps();
        setFermenterDependencies(deps);

        expect(fermenterDependenciesHolder.current).toBe(deps);
    });

    it('a second set replaces the first (no accumulation)', () => {
        const first = makeDeps();
        const second = makeDeps();

        setFermenterDependencies(first);
        setFermenterDependencies(second);

        expect(fermenterDependenciesHolder.current).toBe(second);
        expect(fermenterDependenciesHolder.current).not.toBe(first);
    });

    it('the stored deps can be called through the holder', () => {
        const clampFn = (input: { deviceType: string; paramId: string; value: number }) => input.value * 2;
        const persistFn = (_a: string, _b: string, _c: number) => undefined;
        setFermenterDependencies(
            makeDeps({
                clampDeviceParameterValue: clampFn,
                persistDeviceParam: persistFn,
            })
        );

        const result = fermenterDependenciesHolder.current!.clampDeviceParameterValue({
            deviceType: 'fermenter',
            paramId: 'gain',
            value: 5,
        });

        expect(result).toBe(10);
    });
});
