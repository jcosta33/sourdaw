import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawMiniSectionHeader } from '../DawMiniSectionHeader';

describe('DawMiniSectionHeader', () => {
    it('should render label', () => {
        render(<DawMiniSectionHeader label="Oscillators" />);
        expect(screen.getByText('Oscillators')).toBeInTheDocument();
    });

    it('should omit seam when showSeam is false', () => {
        const { container } = render(<DawMiniSectionHeader label="L" showSeam={false} />);
        expect(container.querySelector('.daw-seam')).toBeNull();
    });
});
