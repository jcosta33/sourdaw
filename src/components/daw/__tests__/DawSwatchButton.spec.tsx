import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DawSwatchButton } from '../DawSwatchButton';

describe('DawSwatchButton', () => {
    it('should set background color and active ring', () => {
        const onClick = vi.fn();
        render(<DawSwatchButton color="#112233" active onClick={onClick} aria-label="c1" />);
        expect(screen.getByRole('button', { name: 'c1' })).toHaveStyle({ backgroundColor: '#112233' });
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalled();
    });

    it('exposes aria-pressed reflecting the active state', () => {
        // The swatch's selected state was only visual (a CSS ring); aria-pressed
        // makes it DOM-observable so a test or AT can tell which swatch is active.
        const { rerender } = render(<DawSwatchButton color="#112233" active aria-label="c1" />);
        expect(screen.getByRole('button', { name: 'c1' })).toHaveAttribute('aria-pressed', 'true');

        rerender(<DawSwatchButton color="#112233" aria-label="c1" />);
        expect(screen.getByRole('button', { name: 'c1' })).toHaveAttribute('aria-pressed', 'false');
    });
});
