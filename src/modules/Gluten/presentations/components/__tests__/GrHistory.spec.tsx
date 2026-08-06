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

describe('GrHistory — canvas attributes', () => {
    it('renders with role=img and aria-label', () => {
        const { container } = render(<GrHistory grDb={-3} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('role')).toBe('img');
        expect(canvas?.getAttribute('aria-label')).toBe('Gain reduction history');
    });

    it('applies custom width and height to the canvas style', () => {
        const { container } = render(<GrHistory grDb={-3} width={300} height={80} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('style')).toContain('width: 300px');
        expect(canvas?.getAttribute('style')).toContain('height: 80px');
    });

    it('uses default width=400 and height=60 when not provided', () => {
        const { container } = render(<GrHistory grDb={-3} />);
        const canvas = container.querySelector('canvas');
        expect(canvas?.getAttribute('style')).toContain('width: 400px');
        expect(canvas?.getAttribute('style')).toContain('height: 60px');
    });
});
