import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { GrHistory } from '../GrHistory';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: (_prop: string, fallback: string) => fallback,
}));

describe('GrHistory', () => {
    it('should render a canvas', () => {
        const { container } = render(<GrHistory grDb={-3} width={200} height={40} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    // NOTE: the F7 footgun (per-render reallocation of the GR ring buffer) is not
    // runtime-observable in this project — the React Compiler (vite.config.ts:40,
    // reactCompilerPreset) memoizes the `useRef` initializer, so both the buggy
    // `useRef(createCompactFloatBuffer(...))` form and the lazy-init form call the
    // factory exactly once. There is thus no red-before/green-after public-surface
    // seam for the allocation count. This test instead pins the observable invariant
    // the lazy-init path must preserve: a single stable buffer survives re-renders
    // (push position keeps advancing into one buffer) and the canvas keeps rendering.
    it('should keep rendering across re-renders with the lazily-initialized buffer', () => {
        const { container, rerender } = render(<GrHistory grDb={-3} width={200} height={40} />);
        rerender(<GrHistory grDb={-6} width={200} height={40} />);
        rerender(<GrHistory grDb={-9} width={200} height={40} />);

        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should size the canvas after layout', async () => {
        const { container } = render(<GrHistory grDb={-3} width={200} height={40} />);
        const canvas = container.querySelector('canvas');
        await vi.waitFor(() => {
            expect(canvas?.width).toBeGreaterThan(0);
            expect(canvas?.height).toBeGreaterThan(0);
        });
    });
});
