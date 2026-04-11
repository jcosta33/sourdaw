import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResizeHandle } from '../ResizeHandle';

// Mock external dependencies
vi.mock('#/modules/Arrangement/useCases/toggleTrackState/setTrackHeight', () => ({
    setTrackHeight: vi.fn(),
}));

describe('ResizeHandle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should have correct role', () => {
        render(<ResizeHandle trackId="track1" />);
        expect(screen.getByRole('separator')).toBeInTheDocument();
    });

    it('should have correct aria attributes', () => {
        render(<ResizeHandle trackId="track1" />);
        const separator = screen.getByRole('separator');
        expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
        expect(separator).toHaveAttribute('aria-label', 'Resize track height');
    });

    it('should have resize cursor', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('cursor-ns-resize');
    });

    it('should handle mouse down', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        expect(handle).toBeInTheDocument();
    });

    it('should set body cursor during resize', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        const handle = container.firstChild as HTMLElement;
        fireEvent.mouseDown(handle, { button: 0, clientY: 100 });
        expect(document.body.style.cursor).toBe('ns-resize');
    });

    it('should have hover opacity', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('opacity-0');
        expect(container.firstChild).toHaveClass('hover:opacity-100');
    });

    it('should have transition', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('transition-opacity');
    });

    it('should have correct positioning', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('absolute');
        expect(container.firstChild).toHaveClass('bottom-0');
        expect(container.firstChild).toHaveClass('left-0');
        expect(container.firstChild).toHaveClass('right-0');
    });

    it('should have correct height', () => {
        const { container } = render(<ResizeHandle trackId="track1" />);
        expect(container.firstChild).toHaveClass('h-1');
    });
});
