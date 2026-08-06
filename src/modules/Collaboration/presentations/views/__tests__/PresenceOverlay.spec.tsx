import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { usePresence } from '../../hooks/usePresence';
import { PresenceOverlay } from '../PresenceOverlay';

vi.mock('../../hooks/usePresence', () => ({
    usePresence: vi.fn(),
}));

const defaultProps = {
    beatToX: (beat: number) => beat * 10,
    trackIdToY: (_id: string) => 100,
    trackHeight: 80,
};

describe('PresenceOverlay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing when no peers are present', () => {
        vi.mocked(usePresence).mockReturnValue([]);
        const { container } = render(<PresenceOverlay {...defaultProps} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('renders both playhead and cursor markers when a peer has both', () => {
        vi.mocked(usePresence).mockReturnValue([
            {
                peerId: 'peer-1',
                name: 'Alice',
                color: '#ff0000',
                playheadBeat: 10,
                cursorBeat: 20,
                cursorTrackId: 'track-1',
            },
        ]);
        render(<PresenceOverlay {...defaultProps} />);
        // Alice's name appears on both the playhead marker and the cursor marker
        expect(screen.getAllByText('Alice').length).toBe(2);
    });

    it('renders only cursor marker when playhead beat is null', () => {
        vi.mocked(usePresence).mockReturnValue([
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
        // Bob has no playhead — only cursor marker
        expect(screen.getAllByText('Bob').length).toBe(1);
    });

    it('renders only playhead marker when cursor beat is null', () => {
        vi.mocked(usePresence).mockReturnValue([
            {
                peerId: 'peer-3',
                name: 'Carol',
                color: '#0000ff',
                playheadBeat: 5,
                cursorBeat: null,
                cursorTrackId: null,
            },
        ]);
        render(<PresenceOverlay {...defaultProps} />);
        expect(screen.getAllByText('Carol').length).toBe(1);
    });

    it('renders no markers for a peer with both playhead and cursor null', () => {
        vi.mocked(usePresence).mockReturnValue([
            {
                peerId: 'peer-4',
                name: 'Dave',
                color: '#ffffff',
                playheadBeat: null,
                cursorBeat: null,
                cursorTrackId: null,
            },
        ]);
        render(<PresenceOverlay {...defaultProps} />);
        expect(screen.queryByText('Dave')).toBeNull();
    });

    it('positions cursor at beatToX(cursorBeat)', () => {
        vi.mocked(usePresence).mockReturnValue([
            {
                peerId: 'peer-5',
                name: 'Eve',
                color: '#ff00ff',
                playheadBeat: null,
                cursorBeat: 15,
                cursorTrackId: 'track-1',
            },
        ]);
        render(<PresenceOverlay {...defaultProps} />);
        // beatToX(15) = 150 → label positioned at left + offset = 152
        const label = screen.getByText('Eve');
        expect(label.getAttribute('style')).toContain('left: 152px');
    });
});
