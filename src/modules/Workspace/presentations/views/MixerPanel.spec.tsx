import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MixerPanel } from './MixerPanel';

// Mock hooks
vi.mock('../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({
        tracks: [
            { id: 'track-1', kind: 'audio', name: 'Audio 1' },
            { id: 'track-2', kind: 'midi', name: 'Midi 1' },
        ],
        selectedTrackId: 'track-1',
    })),
}));

vi.mock('../hooks/useWorkspaceState', () => ({
    useWorkspaceState: vi.fn(() => ({
        channelStripWidth: 'normal',
    })),
}));

// Mock useCases
vi.mock('../../useCases/togglePanel/panelToggles', () => ({
    cycleChannelStripWidth: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/mixerSnapshot/operations', () => ({
    saveMixerSnapshot: vi.fn(),
    recallMixerSnapshot: vi.fn(),
    getMixerSnapshots: vi.fn(() => [{ id: 'snap-1', name: 'Snapshot 1' }]),
    deleteMixerSnapshot: vi.fn(),
    renameMixerSnapshot: vi.fn(),
    restoreMixerChannels: vi.fn(),
}));

// Mock child components
vi.mock('./Mixer/ExpandedChannelStrip', () => ({
    ExpandedChannelStrip: ({ track }: any) => <div data-testid={`channel-strip-${track.id}`}>{track.name}</div>,
}));

vi.mock('./Mixer/MasterChannelStrip', () => ({
    MasterChannelStrip: () => <div data-testid="master-channel-strip">Master</div>,
}));

describe('MixerPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render all channel strips and master', () => {
        render(<MixerPanel />);
        expect(screen.getByTestId('channel-strip-track-1')).toBeInTheDocument();
        expect(screen.getByTestId('channel-strip-track-2')).toBeInTheDocument();
        expect(screen.getByTestId('master-channel-strip')).toBeInTheDocument();
    });

    it('should call cycleChannelStripWidth on width button click', async () => {
        render(<MixerPanel />);
        const widthButton = screen.getByLabelText(/Channel width:/);
        fireEvent.click(widthButton);
        
        const { cycleChannelStripWidth } = await import('../../useCases/togglePanel/panelToggles');
        expect(cycleChannelStripWidth).toHaveBeenCalled();
    });

    it('should show and hide snapshots panel', async () => {
        render(<MixerPanel />);
        const snapshotsButton = screen.getByLabelText('Recall mixer snapshot');
        
        fireEvent.click(snapshotsButton);
        expect(screen.getByText('Snapshot 1')).toBeInTheDocument();
        
        // Click save snapshot
        const saveButton = screen.getByLabelText('Save mixer snapshot');
        fireEvent.click(saveButton);
        
        const { saveMixerSnapshot } = await import('#/modules/Arrangement/useCases/mixerSnapshot/operations');
        expect(saveMixerSnapshot).toHaveBeenCalled();
    });

    it('should render correct title based on track count', () => {
        render(<MixerPanel />);
        expect(screen.getByText(/Mixer - 2 channels/i)).toBeInTheDocument();
    });
});
