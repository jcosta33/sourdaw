import { describe, it, expect, vi } from 'vitest';

const { getDrumKitByIndex } = vi.hoisted(() => ({
    getDrumKitByIndex: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({ getDrumKitByIndex }));

import { resolveDrumKit } from '../resolveDrumKit';

const sampleKit = {
    id: 'kit-0',
    name: 'Standard Kit',
    voices: [{ name: 'kick', pitchRange: [0, 0] as [number, number], params: { gain: 1 } }],
};

describe('resolveDrumKit', () => {
    it('returns null when no device on the chain is a drum device', () => {
        // A chain with only non-drum devices must not resolve a kit.
        const result = resolveDrumKit([{ type: 'eq', parameterValues: {} }]);
        expect(result).toBeNull();
        expect(getDrumKitByIndex).not.toHaveBeenCalled();
    });

    it('resolves the kit by the explicit kit index when present', () => {
        getDrumKitByIndex.mockReturnValue(sampleKit);
        const result = resolveDrumKit([
            { type: 'eq', parameterValues: {} },
            { type: 'builtin-drum-kit', parameterValues: { kit: 3 } },
        ]);
        // The first drum device wins (Array.find); its kit index drives the lookup.
        expect(getDrumKitByIndex).toHaveBeenCalledWith(3);
        expect(result).toBe(sampleKit);
    });

    it('falls back to the legacy kitId parameter when kit is absent', () => {
        // Older device patches store the index under kitId; the `?? kitId ?? 0`
        // chain must still resolve it.
        getDrumKitByIndex.mockReturnValue(sampleKit);
        resolveDrumKit([{ type: 'drum-kit', parameterValues: { kitId: 5 } }]);
        expect(getDrumKitByIndex).toHaveBeenCalledWith(5);
    });

    it('defaults the index to 0 when neither kit nor kitId is set', () => {
        getDrumKitByIndex.mockReturnValue(sampleKit);
        resolveDrumKit([{ type: 'builtin-drum-machine-808', parameterValues: {} }]);
        expect(getDrumKitByIndex).toHaveBeenCalledWith(0);
    });
});
