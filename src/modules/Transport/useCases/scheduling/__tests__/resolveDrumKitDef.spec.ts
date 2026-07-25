import { describe, it, expect, vi } from 'vitest';

const { getDrumKitDefByIndex } = vi.hoisted(() => ({
    getDrumKitDefByIndex: vi.fn(),
}));

vi.mock('#/modules/Synth/useCases', () => ({ getDrumKitDefByIndex }));

import { resolveDrumKitDef } from '../resolveDrumKitDef';

const sampleDef = {
    id: 'def-0',
    name: 'Standard',
    voices: [
        { name: 'kick', synth: { type: 'sine' as const, frequency: 60 } },
    ],
};

describe('resolveDrumKitDef', () => {
    it('returns null when no device on the chain is a drum device', () => {
        const result = resolveDrumKitDef([{ type: 'eq', parameterValues: {} }]);
        expect(result).toBeNull();
        expect(getDrumKitDefByIndex).not.toHaveBeenCalled();
    });

    it('resolves the kit definition by the explicit kit index when present', () => {
        getDrumKitDefByIndex.mockReturnValue(sampleDef);
        const result = resolveDrumKitDef([
            { type: 'compressor', parameterValues: {} },
            { type: 'builtin-drum-kit', parameterValues: { kit: 2 } },
        ]);
        expect(getDrumKitDefByIndex).toHaveBeenCalledWith(2);
        expect(result).toBe(sampleDef);
    });

    it('falls back to the legacy kitId parameter when kit is absent', () => {
        getDrumKitDefByIndex.mockReturnValue(sampleDef);
        resolveDrumKitDef([{ type: 'drum-kit', parameterValues: { kitId: 7 } }]);
        expect(getDrumKitDefByIndex).toHaveBeenCalledWith(7);
    });

    it('defaults the index to 0 when neither kit nor kitId is set', () => {
        getDrumKitDefByIndex.mockReturnValue(sampleDef);
        resolveDrumKitDef([{ type: 'builtin-drum-machine-909', parameterValues: {} }]);
        expect(getDrumKitDefByIndex).toHaveBeenCalledWith(0);
    });
});
