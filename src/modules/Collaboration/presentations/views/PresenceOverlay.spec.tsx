import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceOverlay } from './PresenceOverlay';

// Mock the usePresence hook
vi.mock('../hooks/usePresence', () => ({
    usePresence: vi.fn(() => new Map()),
}));

describe('PresenceOverlay', () => {
    const mockBeatToX = vi.fn((beat: number) => beat * 10);
    const mockTrackIdToY = vi.fn(() => 50);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = render(
            <PresenceOverlay
                beatToX={mockBeatToX}
                trackIdToY={mockTrackIdToY}
                trackHeight={40}
            />
        );
        expect(container.firstChild).toBeInTheDocument();
    });

    it('should render with empty presence map', () => {
        const { container } = render(
            <PresenceOverlay
                beatToX={mockBeatToX}
                trackIdToY={mockTrackIdToY}
                trackHeight={40}
            />
        );
        expect(container.querySelector('.pointer-events-none')).toBeInTheDocument();
    });

    it('should apply correct CSS classes', () => {
        const { container } = render(
            <PresenceOverlay
                beatToX={mockBeatToX}
                trackIdToY={mockTrackIdToY}
                trackHeight={40}
            />
        );
        const overlay = container.firstChild as HTMLElement;
        expect(overlay.classList.contains('pointer-events-none')).toBe(true);
        expect(overlay.classList.contains('absolute')).toBe(true);
        expect(overlay.classList.contains('inset-0')).toBe(true);
    });
});
