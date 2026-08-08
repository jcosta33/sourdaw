import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFermenterBuffer, useFermenterPeaks } from '../useFermenterTelemetry';

import type { FermenterState } from '../../../stores/fermenterStore';

/**
 * `useStoreSelector` is the seam through which the telemetry hooks read the
 * store. Capturing the selector + equality fn the hook passes lets the spec
 * exercise the selector's branching directly with controlled store states —
 * the only logic the hooks own.
 */
const mocks = vi.hoisted(() => ({
    useStoreSelector: vi.fn(),
}));

vi.mock('#/infra/store/useStoreSelector', () => ({
    useStoreSelector: mocks.useStoreSelector,
}));

vi.mock('../../../stores/fermenterStore', () => ({
    fermenterStore: { id: 'fermenter-store-stub' },
}));

/**
 * Call the hook, then extract the selector (and equality fn) it registered.
 * The hook returns whatever the mocked `useStoreSelector` is told to return.
 */
function captureSelector<THookReturn>(
    hookFn: () => THookReturn,
    captured: { selector?: (...args: never[]) => unknown; equality?: (...args: never[]) => unknown }
): THookReturn {
    mocks.useStoreSelector.mockImplementation(
        (_store: unknown, selector: (...args: never[]) => unknown, equality?: (...args: never[]) => unknown) => {
            captured.selector = selector;
            captured.equality = equality;
            return null;
        }
    );
    const { result } = renderHook(() => hookFn());
    return result.current;
}

const makeState = (deviceId: string, partial: Partial<FermenterState>): Record<string, FermenterState> => ({
    [deviceId]: {
        patch: {} as FermenterState['patch'],
        activeVoices: 0,
        engineReady: false,
        uiLevel: 2,
        peakL: 0,
        peakR: 0,
        scopeBuffer: null,
        ...partial,
    },
});

describe('useFermenterBuffer', () => {
    it('selects the scopeBuffer for the given device', () => {
        const captured: { selector?: (...args: never[]) => unknown } = {};
        const buffer = new Float32Array([1, 2, 3]);
        captureSelector(() => useFermenterBuffer('dev-1'), captured);

        const result = captured.selector!(makeState('dev-1', { scopeBuffer: buffer }) as never);

        expect(result).toBe(buffer);
    });

    it('returns null when the store has no entry for the device', () => {
        const captured: { selector?: (...args: never[]) => unknown } = {};
        captureSelector(() => useFermenterBuffer('dev-missing'), captured);

        const result = captured.selector!(makeState('dev-1', { scopeBuffer: new Float32Array() }) as never);

        expect(result).toBeNull();
    });

    it('returns null when the store itself is null (not yet hydrated)', () => {
        const captured: { selector?: (...args: never[]) => unknown } = {};
        captureSelector(() => useFermenterBuffer('dev-1'), captured);

        const result = captured.selector!(null as never);

        expect(result).toBeNull();
    });

    it('uses referential equality (===) so the same Float32Array does not trigger a re-render', () => {
        const captured: { equality?: (...args: never[]) => unknown } = {};
        captureSelector(() => useFermenterBuffer('dev-1'), captured);

        const a = new Float32Array([1]);
        // Same reference → equal.
        expect(captured.equality!(a as never, a as never)).toBe(true);
        // Different reference with same contents → not equal (referential check).
        expect(captured.equality!(a as never, new Float32Array([1]) as never)).toBe(false);
    });
});

describe('useFermenterPeaks', () => {
    it('selects the peak pair for the given device', () => {
        const captured: { selector?: (...args: never[]) => unknown } = {};
        captureSelector(() => useFermenterPeaks('dev-1'), captured);

        const result = captured.selector!(makeState('dev-1', { peakL: 0.7, peakR: 0.3 }) as never) as {
            peakL: number;
            peakR: number;
        };

        expect(result).toEqual({ peakL: 0.7, peakR: 0.3 });
    });

    it('returns zeroed peaks when the device is missing from the store', () => {
        const captured: { selector?: (...args: never[]) => unknown } = {};
        captureSelector(() => useFermenterPeaks('dev-missing'), captured);

        const result = captured.selector!(makeState('dev-1', { peakL: 0.9, peakR: 0.8 }) as never) as {
            peakL: number;
            peakR: number;
        };

        expect(result).toEqual({ peakL: 0, peakR: 0 });
    });

    it('returns zeroed peaks when the store itself is null', () => {
        const captured: { selector?: (...args: never[]) => unknown } = {};
        captureSelector(() => useFermenterPeaks('dev-1'), captured);

        const result = captured.selector!(null as never) as { peakL: number; peakR: number };

        expect(result).toEqual({ peakL: 0, peakR: 0 });
    });

    it('uses value equality on peakL and peakR so unchanged levels do not re-render', () => {
        const captured: { equality?: (...args: never[]) => unknown } = {};
        captureSelector(() => useFermenterPeaks('dev-1'), captured);

        const eq = captured.equality!;
        const same = { peakL: 0.5, peakR: 0.5 } as never;
        // Same values → equal.
        expect(eq(same, { peakL: 0.5, peakR: 0.5 } as never)).toBe(true);
        // Different peakL → not equal.
        expect(eq(same, { peakL: 0.6, peakR: 0.5 } as never)).toBe(false);
        // Different peakR → not equal.
        expect(eq(same, { peakL: 0.5, peakR: 0.6 } as never)).toBe(false);
    });
});
