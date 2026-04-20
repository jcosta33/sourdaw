import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DawEyebrowLabel } from '../DawEyebrowLabel';

describe('DawEyebrowLabel', () => {
    it('should render children', () => {
        render(<DawEyebrowLabel>Section</DawEyebrowLabel>);
        expect(screen.getByText('Section')).toBeInTheDocument();
    });

    it('should default to xs size class', () => {
        const { container } = render(<DawEyebrowLabel>A</DawEyebrowLabel>);
        expect(container.firstChild).toHaveClass('text-[9px]');
    });

    it('should apply sm size class when size is sm', () => {
        const { container } = render(<DawEyebrowLabel size="sm">A</DawEyebrowLabel>);
        expect(container.firstChild).toHaveClass('text-[10px]');
    });

    it('should merge custom className with eyebrow styles', () => {
        const { container } = render(<DawEyebrowLabel className="extra">A</DawEyebrowLabel>);
        expect(container.firstChild).toHaveClass('extra', 'font-medium', 'uppercase');
    });

    it('should forward native span attributes', () => {
        render(
            <DawEyebrowLabel id="eb-label" data-testid="eb">
                A
            </DawEyebrowLabel>
        );
        const el = screen.getByTestId('eb');
        expect(el).toHaveAttribute('id', 'eb-label');
    });
});
