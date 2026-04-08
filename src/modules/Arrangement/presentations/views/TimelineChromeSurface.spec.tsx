import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelineChromeSurface } from './TimelineChromeSurface';

describe('TimelineChromeSurface', () => {
    it('should render without crashing', () => {
        const { container } = render(<TimelineChromeSurface />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render children', () => {
        render(
            <TimelineChromeSurface>
                <div data-testid="child">Child Content</div>
            </TimelineChromeSurface>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('should apply default tone class', () => {
        const { container } = render(<TimelineChromeSurface />);
        expect(container.firstChild).toHaveClass('daw-header-band');
    });

    it('should apply subtle tone class when specified', () => {
        const { container } = render(<TimelineChromeSurface tone="subtle" />);
        expect(container.firstChild).toHaveClass('border-b');
        expect(container.firstChild).toHaveClass('bg-surface-base');
    });

    it('should apply custom className', () => {
        const { container } = render(<TimelineChromeSurface className="custom-class" />);
        expect(container.firstChild).toHaveClass('custom-class');
    });

    it('should pass through additional props', () => {
        const { container } = render(
            <TimelineChromeSurface data-testid="surface" style={{ height: 100 }} />
        );
        const surface = screen.getByTestId('surface');
        expect(surface).toHaveStyle({ height: '100px' });
    });

    it('should have relative positioning', () => {
        const { container } = render(<TimelineChromeSurface />);
        expect(container.firstChild).toHaveClass('relative');
    });

    it('should have full width', () => {
        const { container } = render(<TimelineChromeSurface />);
        expect(container.firstChild).toHaveClass('w-full');
    });

    it('should forward ref', () => {
        const ref = { current: null as HTMLDivElement | null };
        render(<TimelineChromeSurface ref={(el) => { ref.current = el; }} />);
        expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
});
