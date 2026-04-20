import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawMiniSectionHeader } from '../DawMiniSectionHeader';

describe('DawMiniSectionHeader', () => {
    it('should render label', () => {
        render(<DawMiniSectionHeader label="Oscillators" />);
        expect(screen.getByText('Oscillators')).toBeInTheDocument();
    });

    it('should render seam by default', () => {
        const { container } = render(<DawMiniSectionHeader label="L" />);
        expect(container.querySelector('.daw-seam')).not.toBeNull();
    });

    it('should omit seam when showSeam is false', () => {
        const { container } = render(<DawMiniSectionHeader label="L" showSeam={false} />);
        expect(container.querySelector('.daw-seam')).toBeNull();
    });

    it('should merge custom className onto the root', () => {
        const { container } = render(<DawMiniSectionHeader label="L" className="extra" />);
        expect(container.firstElementChild).toHaveClass('extra', 'w-full', 'space-y-0.5');
    });

    it('should forward div attributes', () => {
        render(<DawMiniSectionHeader label="L" data-testid="hdr" aria-label="Section" />);
        const el = screen.getByTestId('hdr');
        expect(el).toHaveAttribute('aria-label', 'Section');
    });
});
