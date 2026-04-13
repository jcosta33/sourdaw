import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePresence } from '../../hooks/usePresence';
import { PresenceOverlay } from '../PresenceOverlay';

// Mock external dependencies
vi.mock('../../hooks/usePresence', () => ({
    usePresence: vi.fn(),
}));

describe('PresenceOverlay', () => {
    const defaultProps = {
        beatToX: (beat: number) => beat * 10,
        trackIdToY: (_id: string) => 100,
        trackHeight: 80,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        vi.mocked(usePresence).mockReturnValue([]);
        const { container } = render(<PresenceOverlay {...defaultProps} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render collaborator cursors', () => {
        vi.mocked(usePresence).mockReturnValue([
            {
                peerId: 'peer-1',
                name: 'Alice',
                color: '#ff0000',
                playheadBeat: 10,
                cursorBeat: 20,
                cursorTrackId: 'track-1',
            },
            {
                peerId: 'peer-2',
                name: 'Bob',
                color: '#00ff00',
                playheadBeat: null,
                cursorBeat: 40,
                cursorTrackId: null,
            },
        ]);
        render(<PresenceOverlay {...defaultProps} />);
        
        // Cursors are rendered by PresenceMarker which usually shows the name
        expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
    });
});
