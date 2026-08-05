import { describe, expect, it, vi } from 'vitest';

import {
    type DeviceLayoutComponent,
    filterParams,
    registerDeviceLayout,
    registerPrefixLayout,
    resolveDeviceLayout,
} from '../deviceLayoutRegistry';

const makeComponent = (): DeviceLayoutComponent => vi.fn(() => null);

describe('registerDeviceLayout / resolveDeviceLayout', () => {
    it('resolves an exact-match layout registered for a single type', () => {
        const layout = makeComponent();
        registerDeviceLayout('test-exact-single', layout);
        expect(resolveDeviceLayout('test-exact-single')).toBe(layout);
    });

    it('resolves exact-match layouts registered for multiple types', () => {
        const layout = makeComponent();
        registerDeviceLayout(['test-multi-a', 'test-multi-b'], layout);
        expect(resolveDeviceLayout('test-multi-a')).toBe(layout);
        expect(resolveDeviceLayout('test-multi-b')).toBe(layout);
    });

    it('returns null when no exact or prefix match exists', () => {
        expect(resolveDeviceLayout('nonexistent-device-type')).toBeNull();
    });
});

describe('registerPrefixLayout / resolveDeviceLayout', () => {
    it('resolves a prefix-match layout when no exact match exists', () => {
        const layout = makeComponent();
        registerPrefixLayout('test-prefix-', layout);
        expect(resolveDeviceLayout('test-prefix-foo')).toBe(layout);
        expect(resolveDeviceLayout('test-prefix-bar')).toBe(layout);
    });

    it('prefers exact match over prefix match', () => {
        const exact = makeComponent();
        const prefix = makeComponent();
        registerPrefixLayout('test-priority-', prefix);
        registerDeviceLayout('test-priority-special', exact);
        expect(resolveDeviceLayout('test-priority-special')).toBe(exact);
        expect(resolveDeviceLayout('test-priority-other')).toBe(prefix);
    });
});

describe('filterParams', () => {
    it('filters parameters to only those with matching ids', () => {
        const params = [
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
            { id: 'c', name: 'C' },
        ] as unknown as Parameters<typeof filterParams>[0];
        const result = filterParams(params, ['a', 'c']);
        expect(result.map((p) => p.id)).toEqual(['a', 'c']);
    });

    it('returns an empty array when no ids match', () => {
        const params = [{ id: 'a' }, { id: 'b' }] as unknown as Parameters<typeof filterParams>[0];
        expect(filterParams(params, ['x', 'y'])).toEqual([]);
    });

    it('preserves the order of the ids argument, not the params array', () => {
        const params = [
            { id: 'c', name: 'C' },
            { id: 'a', name: 'A' },
            { id: 'b', name: 'B' },
        ] as unknown as Parameters<typeof filterParams>[0];
        // filterParams uses .filter on params, so order follows params, not ids
        const result = filterParams(params, ['a', 'b', 'c']);
        expect(result.map((p) => p.id)).toEqual(['c', 'a', 'b']);
    });
});
