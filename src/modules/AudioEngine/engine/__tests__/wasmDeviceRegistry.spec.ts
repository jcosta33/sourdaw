import { describe, it, expect } from 'vitest';
import { findWasmDescriptor } from '../wasmDeviceRegistry';

const REGISTERED_WASM_DEVICE_TYPES = [
    'fermenter',
    'toaster',
    'levain',
    'dutch-oven',
    'gluten',
    'bacteria',
    'grinder',
    'proof',
    'native-scoring',
    'grand-boule',
] as const;

describe('findWasmDescriptor', () => {
    it('should return the descriptor for each registered WASM device type', () => {
        for (const type of REGISTERED_WASM_DEVICE_TYPES) {
            const desc = findWasmDescriptor(type);
            expect(desc, type).toBeDefined();
            expect(desc!.matches(type)).toBe(true);
        }
    });

    it('should not return a descriptor for unknown device types', () => {
        expect(findWasmDescriptor('unknown-plugin')).toBeUndefined();
        expect(findWasmDescriptor('')).toBeUndefined();
    });
});
