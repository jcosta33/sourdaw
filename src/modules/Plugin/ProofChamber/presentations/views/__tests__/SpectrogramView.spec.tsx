import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpectrogramView } from '../SpectrogramView';

describe('SpectrogramView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<SpectrogramView />);
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('should render with isMocking prop', () => {
        render(<SpectrogramView isMocking={true} />);
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('should render without isMocking prop', () => {
        render(<SpectrogramView isMocking={false} />);
        expect(document.querySelector('canvas')).toBeInTheDocument();
    });

    it('should display Spectral tail label', () => {
        render(<SpectrogramView />);
        expect(screen.getByText(/Spectral tail/i)).toBeInTheDocument();
    });

    it('should display Preview label when mocking', () => {
        render(<SpectrogramView isMocking={true} />);
        expect(screen.getByText(/Preview/i)).toBeInTheDocument();
    });

    it('should display Live label when not mocking', () => {
        render(<SpectrogramView isMocking={false} />);
        expect(screen.getByText(/Live/i)).toBeInTheDocument();
    });

    it('should apply correct container styles', () => {
        const { container } = render(<SpectrogramView />);
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.classList.contains('relative')).toBe(true);
        expect(wrapper.classList.contains('h-48')).toBe(true);
        expect(wrapper.classList.contains('w-full')).toBe(true);
    });

    it('should render canvas with correct dimensions', () => {
        render(<SpectrogramView />);
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        expect(canvas).toBeInTheDocument();
        expect(canvas.width).toBe(600);
        expect(canvas.height).toBe(200);
    });
});
