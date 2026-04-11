import { describe, it, expect } from 'vitest';
import { resolveDeviceParam, resolveDrumKit } from '../deviceResolution';

describe('resolveDrumKit', () => {
    it('should return null when no drum kit device is present', () => {
        expect(resolveDrumKit([{ type: 'builtin-gain', parameterValues: {} }])).toBeNull();
    });

    it('should resolve the kit from a builtin-drum-kit device using kit index', () => {
        const kit = resolveDrumKit([{ type: 'builtin-drum-kit', parameterValues: { kit: 0 } }]);
        expect(kit).not.toBeNull();
        expect(kit?.id).toBeDefined();
    });

    it('should treat builtin-drum-machine prefix like a drum kit device', () => {
        const kit = resolveDrumKit([{ type: 'builtin-drum-machine-x', parameterValues: { kitId: 0 } }]);
        expect(kit).not.toBeNull();
    });

    it('should prefer kit from the first matching device in the list', () => {
        const a = resolveDrumKit([
            { type: 'builtin-drum-kit', parameterValues: { kit: 0 } },
            { type: 'builtin-drum-kit', parameterValues: { kit: 1 } },
        ]);
        const b = resolveDrumKit([
            { type: 'builtin-drum-kit', parameterValues: { kit: 1 } },
            { type: 'builtin-drum-kit', parameterValues: { kit: 0 } },
        ]);
        expect(a?.id).not.toBe(b?.id);
    });
});

describe('resolveDeviceParam', () => {
    it('should resolve builtin-gain gain-level from the first node', () => {
        const gainParam = { value: 0.25 } as AudioParam;
        const gainNode = { gain: gainParam } as GainNode;
        const node = {
            inputNode: gainNode as unknown as AudioNode,
            outputNode: gainNode as unknown as AudioNode,
            nodes: [gainNode as unknown as AudioNode],
        };

        expect(resolveDeviceParam('builtin-gain', 'gain-level', node)).toBe(gainParam);
    });

    it('should return null for an unknown device and parameter id pair', () => {
        const node = {
            inputNode: {} as AudioNode,
            outputNode: {} as AudioNode,
            nodes: [],
        };

        expect(resolveDeviceParam('builtin-gain', 'unknown', node)).toBeNull();
        expect(resolveDeviceParam('unknown-device', 'gain-level', node)).toBeNull();
    });
});
