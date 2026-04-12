import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import { GrHistory } from '../GrHistory';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: (_prop: string, fallback: string) => fallback,
}));

describe('GrHistory', () => {
    it('should render a canvas', () => {
        const { container } = render(<GrHistory grDb={-3} width={200} height={40} />);
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
