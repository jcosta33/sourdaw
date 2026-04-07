import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsetPanel } from './InsetPanel';

describe('InsetPanel', () => {
    it('should render children', () => {
        render(<InsetPanel>Inside</InsetPanel>);
        expect(screen.getByText('Inside')).toBeInTheDocument();
    });

    it('should support framed tone', () => {
        const { container } = render(
            <InsetPanel tone="framed" data-testid="panel">
                X
            </InsetPanel>
        );
        expect(container.querySelector('[data-testid="panel"]')).toHaveClass('shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]');
    });
});
