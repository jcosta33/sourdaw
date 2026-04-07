import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DawSwatchButton } from './DawSwatchButton';

describe('DawSwatchButton', () => {
    it('should set background color and active ring', () => {
        const onClick = vi.fn();
        render(<DawSwatchButton color="#112233" active onClick={onClick} aria-label="c1" />);
        expect(screen.getByRole('button', { name: 'c1' })).toHaveStyle({ backgroundColor: '#112233' });
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalled();
    });
});
