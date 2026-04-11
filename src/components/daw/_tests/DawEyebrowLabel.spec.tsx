import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawEyebrowLabel } from '../DawEyebrowLabel';

describe('DawEyebrowLabel', () => {
    it('should render children', () => {
        render(<DawEyebrowLabel>Section</DawEyebrowLabel>);
        expect(screen.getByText('Section')).toBeInTheDocument();
    });

    it('should apply sm size class when size is sm', () => {
        const { container } = render(<DawEyebrowLabel size="sm">A</DawEyebrowLabel>);
        expect(container.firstChild).toHaveClass('text-[10px]');
    });
});
