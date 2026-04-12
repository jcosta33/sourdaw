import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LED } from '../LED';

describe('LED', () => {
    it('should render with aria-hidden', () => {
        const { container } = render(<LED on variant="cyan" />);
        expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    });

    it('should apply size class', () => {
        const { container } = render(<LED on={false} size="lg" />);
        expect(container.firstChild).toHaveClass('size-3');
    });
});
