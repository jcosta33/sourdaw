import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { GrMeter } from '../GrMeter';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: (_prop: string, fallback: string) => fallback,
}));

describe('GrMeter', () => {
    it('should render a canvas', () => {
        const { container } = render(<GrMeter grDb={-2} inputDb={-10} outputDb={-10} width={40} height={80} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should set canvas dimensions from width and height props', async () => {
        const { container } = render(<GrMeter grDb={-2} inputDb={-10} outputDb={-10} width={40} height={80} />);
        const canvas = container.querySelector('canvas');
        await vi.waitFor(() => {
            expect(canvas?.width).toBeGreaterThan(0);
            expect(canvas?.height).toBeGreaterThan(0);
        });
    });
});
