import { describe, expect, it } from 'vitest';

import { getToasterPresetDeviceState } from '../getToasterPresetDeviceState';

describe('getToasterPresetDeviceState', () => {
    it('returns a serialized kit state for a known preset id', () => {
        const state = getToasterPresetDeviceState('808-classic');
        expect(state).not.toBeNull();
        expect(state?.version).toBeDefined();
        expect(state?.data).toBeDefined();
        const kit = state?.data?.kit as Record<string, unknown> | undefined;
        const pads = kit?.pads as unknown[] | undefined;
        expect(pads).toBeDefined();
        expect(pads?.length).toBeGreaterThan(0);
    });

    it('returns null for an unknown preset id', () => {
        expect(getToasterPresetDeviceState('nonexistent-kit')).toBeNull();
    });

    it('does not mutate the factory catalog between calls', () => {
        const first = getToasterPresetDeviceState('init');
        const second = getToasterPresetDeviceState('init');
        expect(first).toEqual(second);
        // Mutating the first result should not affect the second
        const firstKit = first?.data?.kit as Record<string, unknown> | undefined;
        const firstPads = firstKit?.pads as Array<Record<string, unknown>> | undefined;
        if (firstPads?.[0]) {
            firstPads[0].name = 'mutated';
        }
        const third = getToasterPresetDeviceState('init');
        const thirdKit = third?.data?.kit as Record<string, unknown> | undefined;
        const thirdPads = thirdKit?.pads as Array<Record<string, unknown>> | undefined;
        expect(thirdPads?.[0]?.name).not.toBe('mutated');
    });
});
