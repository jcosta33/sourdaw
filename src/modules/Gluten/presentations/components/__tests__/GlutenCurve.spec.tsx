import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

import { GlutenCurve } from '../GlutenCurve';

vi.mock('#/utils/UI/resolveToken', () => ({
    resolveToken: (_prop: string, fallback: string) => fallback,
}));

describe('GlutenCurve', () => {
    it('should render a canvas', () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} width={120} height={80} />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should allocate backing store for width and height', async () => {
        const { container } = render(
            <GlutenCurve threshold={-18} ratio={3} knee={2} makeup={0} grDb={0} inputDb={-12} width={120} height={80} />
        );
        const canvas = container.querySelector('canvas');
        await vi.waitFor(() => {
            expect(canvas?.width).toBeGreaterThan(0);
            expect(canvas?.height).toBeGreaterThan(0);
        });
    });
});
