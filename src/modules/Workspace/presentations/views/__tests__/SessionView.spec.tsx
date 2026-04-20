import { useSyncExternalStore } from 'react';

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';

import { sessionLaunchStore } from '../../../stores/sessionLaunchStore';
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
        // Reset the real store between tests so click handlers that write
        // through sessionLaunchStore.set start from a clean slate.
        sessionLaunchStore.set({ activeSlots: {} });
        // Override the global useStore mock (setupTests.ts) to actually
        // read from the real sessionLaunchStore so click handlers that
        // call sessionLaunchStore.set(...) are reflected in the next
        // render. The global mock returns a frozen blob which does not
        // simulate state updates.
        vi.mocked(useStore).mockImplementation((store: any, defaultValue: any) => {
            if (store === sessionLaunchStore) {
                return useSyncExternalStore(store.subscribeReact, () => store.getSnapshot() ?? defaultValue);
            }
            return defaultValue;
        });
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
        const slot = screen.getByLabelText('Audio 1 scene 1 - clip loaded');
        act(() => {
            fireEvent.click(slot);
        });
        expect(sessionLaunchStore.value?.activeSlots['track-1']).toBe(0);
    });

    it('should launch all tracks in a scene when scene button is clicked', () => {
        render(<SessionView />);
        const sceneButton = screen.getByLabelText('Launch scene 1');
        act(() => {
            fireEvent.click(sceneButton);
        });
        expect(sessionLaunchStore.value?.activeSlots).toEqual({ 'track-1': 0, 'track-2': 0 });
    });

    it('should show empty state when no tracks exist', async () => {
        const { useTracks } = await import('../../hooks/useTracks');
        vi.mocked(useTracks).mockReturnValue({ tracks: [] });

        render(<SessionView />);
        expect(screen.getByText('No session tracks yet')).toBeInTheDocument();
    });
});
