import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Separator } from './separator';

describe('Separator', () => {
    it('should render horizontal separator by default', () => {
        const { container } = render(<Separator />);
        const node = container.querySelector('[data-slot="separator"]');
        expect(node).toBeInTheDocument();
        expect(node).toHaveAttribute('data-orientation', 'horizontal');
    });

    it('should render vertical separator when orientation is vertical', () => {
        const { container } = render(<Separator orientation="vertical" />);
        const node = container.querySelector('[data-slot="separator"]');
        expect(node).toHaveAttribute('data-orientation', 'vertical');
    });
});
