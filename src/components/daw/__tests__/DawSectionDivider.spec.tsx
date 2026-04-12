import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DawSectionDivider } from '../DawSectionDivider';

describe('DawSectionDivider', () => {
    it('should render label and optional start slot', () => {
        render(
            <DawSectionDivider label="Filters" startSlot={<span data-testid="slot">*</span>} />
        );
        expect(screen.getByText('Filters')).toBeInTheDocument();
        expect(screen.getByTestId('slot')).toBeInTheDocument();
    });

    it('should render label without startSlot when omitted', () => {
        render(<DawSectionDivider label="Only" />);
        expect(screen.getByText('Only')).toBeInTheDocument();
    });

    it('should apply labelClassName to the label span', () => {
        render(<DawSectionDivider label="L" labelClassName="lbl-extra" />);
        expect(screen.getByText('L')).toHaveClass('lbl-extra', 'uppercase');
    });

    it('should apply lineClassName to the trailing line', () => {
        const { container } = render(<DawSectionDivider label="L" lineClassName="line-extra" />);
        const line = container.querySelector('.line-extra');
        expect(line).not.toBeNull();
        expect(line).toHaveClass('flex-1', 'h-px');
    });

    it('should merge className on the root', () => {
        const { container } = render(<DawSectionDivider label="L" className="root-extra" data-testid="div" />);
        expect(screen.getByTestId('div')).toHaveClass('root-extra', 'flex', 'items-center');
    });

    it('should forward div attributes', () => {
        render(<DawSectionDivider label="L" role="separator" />);
        expect(screen.getByRole('separator')).toBeInTheDocument();
    });
});
