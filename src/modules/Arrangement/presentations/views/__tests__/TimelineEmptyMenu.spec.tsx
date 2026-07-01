import { type ReactElement } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { isAudioGenerationAvailable } from '#/modules/AudioAnalysis/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { addTrack } from '../../../useCases/addTrack';
import { TimelineEmptyMenu } from '../TimelineEmptyMenu';

// Mock external dependencies
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store: { getSnapshot?: () => unknown; value?: unknown }, defaultValue: unknown) => {
        const snap = typeof store.getSnapshot === 'function' ? store.getSnapshot() : store.value;
        return snap ?? defaultValue;
    }),
}));

vi.mock('../../../stores/trackStore', () => ({
    trackStore: { value: { tracks: [] } },
}));

vi.mock('../../../stores/markerStore', () => ({
    markerStore: { value: { markers: [], sections: [] } },
    defaultMarkerStoreState: { markers: [], sections: [] },
}));

vi.mock('#/modules/Transport/stores/transportStore', () => ({
    transportStore: { value: { tempo: 120 } },
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    isAudioGenerationAvailable: vi.fn(() => false),
}));

vi.mock('../../../useCases/importMidiFile', () => ({
    importMidiFile: vi.fn(),
}));

vi.mock('../../../useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('../../../useCases/clip/addClip', () => ({
    addClip: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/removeMarker', () => ({
    removeMarker: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/setMarkerColor', () => ({
    setMarkerColor: vi.fn(),
}));

vi.mock('../../../useCases/marker/markerOperations/addMarker', () => ({
    addMarker: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

vi.mock('#/utils/UI/useContextMenuDismiss', () => ({
    useContextMenuDismiss: vi.fn(),
}));

const renderWithTooltip = (ui: ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TimelineEmptyMenu', () => {
    const mockOnClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isAudioGenerationAvailable).mockReturnValue(false);
    });

    it('should render without crashing', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId="track1" beat={8} onClose={mockOnClose} />);
        expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('should render Add Track buttons', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Add Audio Track')).toBeInTheDocument();
        expect(screen.getByText('Add MIDI Track')).toBeInTheDocument();
        expect(screen.getByText('Add Bus Track')).toBeInTheDocument();
    });

    it('should render Add Clip Here when trackId is provided', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId="track1" beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Add Clip Here')).toBeInTheDocument();
    });

    it('should render Paste button', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Paste')).toBeInTheDocument();
    });

    it('should render Add Marker Here button', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Add Marker Here')).toBeInTheDocument();
    });

    it('should render Import buttons', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Import Audio…')).toBeInTheDocument();
        expect(screen.getByText('Import MIDI…')).toBeInTheDocument();
    });

    it('should call addTrack when Add Audio Track is clicked', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        const button = screen.getByText('Add Audio Track');
        fireEvent.click(button);
        expect(addTrack).toHaveBeenCalledWith({ name: 'Audio', kind: 'audio' });
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should call onClose when menu item is clicked', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        const button = screen.getByText('Add Audio Track');
        fireEvent.click(button);
        expect(mockOnClose).toHaveBeenCalled();
    });

    it('should show AI Generate section', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('AI Generate')).toBeInTheDocument();
    });

    it('should show desktop-only notice for audio generation when unavailable', () => {
        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId={null} beat={8} onClose={mockOnClose} />);
        expect(screen.getByText('Audio generation requires desktop app')).toBeInTheDocument();
        expect(screen.queryByText('Generate Audio Here…')).not.toBeInTheDocument();
        expect(screen.getByText('Generate Drum Pattern')).toBeInTheDocument();
        expect(screen.getByText('Generate Chord Progression')).toBeInTheDocument();
    });

    it('should call generate audio action when audio generation is available', () => {
        vi.mocked(isAudioGenerationAvailable).mockReturnValue(true);
        const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('  shimmering pad  ');

        renderWithTooltip(<TimelineEmptyMenu x={100} y={100} trackId="track1" beat={8} onClose={mockOnClose} />);

        fireEvent.click(screen.getByText('Generate Audio Here…'));

        expect(promptSpy).toHaveBeenCalledWith('Describe the audio to generate:');
        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'generateAudio',
            payload: { prompt: 'shimmering pad', durationSeconds: 8, trackId: 'track1' },
        });
        expect(notifyUser).toHaveBeenCalledWith('Generating audio… this may take a moment');
        expect(mockOnClose).toHaveBeenCalled();

        promptSpy.mockRestore();
    });

    it('should have correct positioning', () => {
        renderWithTooltip(<TimelineEmptyMenu x={150} y={200} trackId={null} beat={8} onClose={mockOnClose} />);
        const menu = screen.getByRole('menu');
        expect(menu).toHaveStyle({ left: '150px', top: '200px' });
    });
});
