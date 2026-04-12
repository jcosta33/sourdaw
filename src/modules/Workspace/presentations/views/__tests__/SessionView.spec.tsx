import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionView } from '../SessionView';

// Mock hooks
vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [
            { id: 'track-1', name: 'Audio 1', color: '#ff0000', clips: { 'clip-1': { id: 'clip-1' } } },
            { id: 'track-2', name: 'Midi 1', color: '#00ff00', clips: {} },
        ],
    })),
}));

describe('SessionView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render tracks as columns', () => {
        render(<SessionView />);
        expect(screen.getByText('Audio 1')).toBeInTheDocument();
        expect(screen.getByText('Midi 1')).toBeInTheDocument();
    });

    it('should show "Session" title', () => {
        render(<SessionView />);
        expect(screen.getByText('Session')).toBeInTheDocument();
    });

    it('should launch a clip slot when clicked', () => {
        render(<SessionView />);
        // Audio 1, scene 1 has a clip
        const slot = screen.getByLabelText('Audio 1 scene 1 - clip loaded');
        fireEvent.click(slot);
        
        // After click, it should have a play icon (isActive)
        // Since we are mocking Play icon, we check for its presence in the slot
        expect(slot.querySelector('svg')).toBeInTheDocument();
    });

    it('should launch all tracks in a scene when scene button is clicked', () => {
        render(<SessionView />);
        const sceneButton = screen.getByLabelText('Launch scene 1');
        fireEvent.click(sceneButton);
        
        // Both tracks should now have an active slot in scene 1
        const slot1 = screen.getByLabelText('Audio 1 scene 1 - clip loaded');
        expect(slot1.querySelector('svg')).toBeInTheDocument();
    });

    it('should show empty state when no tracks exist', async () => {
        const { useTracks } = await import('../../hooks/useTracks');
        vi.mocked(useTracks).mockReturnValue({ tracks: [] });
        
        render(<SessionView />);
        expect(screen.getByText('No session tracks yet')).toBeInTheDocument();
    });
});
