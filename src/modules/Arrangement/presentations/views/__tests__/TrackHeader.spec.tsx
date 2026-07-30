import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { executeAppAction } from '#/modules/Command/useCases';

// Import mocked functions
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { toggleFolderCollapse } from '../../../useCases/folder/toggleFolderCollapse';
import { setInputMonitoring } from '../../../useCases/setTrackGainPan/setInputMonitoring';
import { selectTrack } from '../../../useCases/toggleTrackState/selectTrack';
import { TrackHeader } from '../TrackHeader';

// Mock external dependencies
vi.mock('../../../useCases/toggleTrackState/muteTrack', () => ({
    muteTrack: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../../../useCases/toggleTrackState/soloTrack', () => ({
    soloTrack: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../../../useCases/toggleTrackState/soloTrackExclusive', () => ({
    soloTrackExclusive: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../../../useCases/toggleTrackState/selectTrack', () => ({
    selectTrack: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
}));

vi.mock('../../../useCases/folder/toggleFolderCollapse', () => ({
    toggleFolderCollapse: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../../../useCases/setTrackGainPan/setInputMonitoring', () => ({
    setInputMonitoring: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../../../useCases/toggleTrackState/toggleVariationLanes', () => ({
    toggleVariationLanes: vi.fn<(...args: unknown[]) => void>(),
}));

vi.mock('../TrackContextMenu', () => ({
    TrackContextMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../TrackHeader/InlineTrackName', () => ({
    InlineTrackName: ({ track }: { track: { name: string } }) => <span>{track.name}</span>,
}));

vi.mock('../TrackHeader/ResizeHandle', () => ({
    ResizeHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock('../TrackHeader/InputSelector', () => ({
    InputSelector: () => <div data-testid="input-selector" />,
}));

vi.mock('../TrackHeader/TrackLevelIndicator', () => ({
    TrackLevelIndicator: () => <div data-testid="level-indicator" />,
}));

vi.mock('../TrackHeader/LevainLoadingSpinner', () => ({
    LevainLoadingSpinner: () => null,
}));

const mockTrack = TrackDummy.create({
    id: 'track1',
    name: 'Test Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    frozen: false,
    freezeState: { status: 'unfrozen' },
    collapsed: false,
    color: '#ff0000',
    inputMonitoring: 'auto',
    inputId: null,
    parentId: null,
    height: 64,
    devices: [],
});

const mockFolderTrack = TrackDummy.create({
    id: 'folder1',
    name: 'Folder Track',
    kind: 'folder',
    muted: false,
    soloed: false,
    armed: false,
    frozen: false,
    freezeState: { status: 'unfrozen' },
    collapsed: false,
    color: '#00ff00',
    inputMonitoring: 'auto',
    inputId: null,
    parentId: null,
    height: 26,
    devices: [],
});

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('TrackHeader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        const { container } = renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render track name', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByText('Test Track')).toBeInTheDocument();
    });

    it('should have correct role and aria attributes', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        const row = screen.getByRole('row');
        expect(row).toHaveAttribute('aria-selected', 'false');
    });

    it('should show aria-selected true when selected', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={true} />);
        const row = screen.getByRole('row');
        expect(row).toHaveAttribute('aria-selected', 'true');
    });

    it('should call selectTrack when clicked', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        const row = screen.getByRole('row');
        fireEvent.click(row);
        expect(selectTrack).toHaveBeenCalledWith('track1');
    });

    it('should render Mute button', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByLabelText(/Mute/)).toBeInTheDocument();
    });

    it('should render Solo button', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByLabelText(/Solo/)).toBeInTheDocument();
    });

    it('should render Arm button', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByLabelText(/Arm/)).toBeInTheDocument();
    });

    it('routes arm changes through the canonical AppAction write path', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);

        fireEvent.click(screen.getByRole('button', { name: 'Arm Test Track' }));

        expect(vi.mocked(executeAppAction)).toHaveBeenCalledWith({
            type: 'armTrack',
            payload: { trackId: 'track1', armed: true },
        });
    });

    it('should render folder track differently', () => {
        renderWithTooltip(<TrackHeader track={mockFolderTrack} isSelected={false} />);
        expect(screen.getByLabelText(/folder/i)).toBeInTheDocument();
    });

    it('should toggle folder collapse', () => {
        renderWithTooltip(<TrackHeader track={mockFolderTrack} isSelected={false} />);
        const collapseButton = screen.getByLabelText(/folder/i);
        fireEvent.click(collapseButton);
        expect(toggleFolderCollapse).toHaveBeenCalledWith('folder1');
    });

    it('should show frozen indicator when frozen', () => {
        const frozenTrack = { ...mockTrack, frozen: true };
        renderWithTooltip(<TrackHeader track={frozenTrack} isSelected={false} />);
        expect(screen.getByText('FROZEN')).toBeInTheDocument();
    });

    it('should render InputSelector for selected audio track', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={true} />);
        expect(screen.getByTestId('input-selector')).toBeInTheDocument();
    });

    it('should render level indicator', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByTestId('level-indicator')).toBeInTheDocument();
    });

    it('should render resize handle', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        expect(screen.getByTestId('resize-handle')).toBeInTheDocument();
    });

    it('should cycle input monitoring on click', () => {
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        const monitorButton = screen.getByLabelText(/Input monitoring/);
        fireEvent.click(monitorButton);
        expect(setInputMonitoring).toHaveBeenCalledWith('track1', 'on');
    });

    it('cycles input monitoring from on to off', () => {
        const track = { ...mockTrack, inputMonitoring: 'on' as const };
        renderWithTooltip(<TrackHeader track={track} isSelected={false} />);
        fireEvent.click(screen.getByLabelText(/Input monitoring/));
        expect(setInputMonitoring).toHaveBeenCalledWith('track1', 'off');
    });

    it('toggles the mute state on click', async () => {
        const { muteTrack } = await import('../../../useCases/toggleTrackState/muteTrack');
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        fireEvent.click(screen.getByLabelText(/Mute/));
        expect(muteTrack).toHaveBeenCalledWith('track1', true);
    });

    it('solos exclusively on a plain click', async () => {
        const { soloTrackExclusive } = await import('../../../useCases/toggleTrackState/soloTrackExclusive');
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        fireEvent.click(screen.getByLabelText(/Solo/));
        expect(soloTrackExclusive).toHaveBeenCalledWith('track1');
    });

    it('solos additively on a meta-modified click', async () => {
        const { soloTrack } = await import('../../../useCases/toggleTrackState/soloTrack');
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        fireEvent.click(screen.getByLabelText(/Solo/), { metaKey: true });
        expect(soloTrack).toHaveBeenCalledWith('track1', true);
    });

    it('renders the freeze progress bar while freezing', () => {
        const freezingTrack = {
            ...mockTrack,
            freezeState: { status: 'freezing' as const, renderProgress: 0.5 },
        };
        renderWithTooltip(<TrackHeader track={freezingTrack} isSelected={false} />);
        expect(screen.getByText('FREEZING')).toBeInTheDocument();
    });

    it('renders the stale badge on a frozen track whose content changed', () => {
        const staleTrack = {
            ...mockTrack,
            frozen: true,
            freezeState: { status: 'stale' as const },
        };
        renderWithTooltip(<TrackHeader track={staleTrack} isSelected={false} />);
        expect(screen.getByText('FROZEN')).toBeInTheDocument();
        expect(screen.getByText('STALE')).toBeInTheDocument();
    });

    it('toggles variation lanes on click', async () => {
        const { toggleVariationLanes } = await import('../../../useCases/toggleTrackState/toggleVariationLanes');
        renderWithTooltip(<TrackHeader track={mockTrack} isSelected={false} />);
        fireEvent.click(screen.getByLabelText('Toggle variation lanes'));
        expect(toggleVariationLanes).toHaveBeenCalledWith('track1');
    });

    it('renders a drum-machine folder with the drum icon and toaster device', () => {
        const drumFolder = {
            ...mockFolderTrack,
            devices: [{ id: 'd1', name: 'Toaster', type: 'toaster', bypassed: false, parameterValues: {} }],
        };
        renderWithTooltip(<TrackHeader track={drumFolder} isSelected={false} />);
        // collapsed=false renders the collapse (down-chevron) affordance.
        expect(screen.getByLabelText('Collapse folder')).toBeInTheDocument();
    });

    it('renders the expand affordance when a folder is collapsed', () => {
        const collapsedFolder = { ...mockFolderTrack, collapsed: true };
        renderWithTooltip(<TrackHeader track={collapsedFolder} isSelected={false} />);
        expect(screen.getByLabelText('Expand folder')).toBeInTheDocument();
    });

    it('selects the folder track on row click', () => {
        renderWithTooltip(<TrackHeader track={mockFolderTrack} isSelected={false} />);
        fireEvent.click(screen.getByRole('row'));
        expect(selectTrack).toHaveBeenCalledWith('folder1');
    });

    it('omits the InputSelector for a midi track even when selected', () => {
        const midiTrack = { ...mockTrack, kind: 'midi' as const };
        renderWithTooltip(<TrackHeader track={midiTrack} isSelected={true} />);
        expect(screen.queryByTestId('input-selector')).not.toBeInTheDocument();
        // midi tracks still expose input monitoring.
        expect(screen.getByLabelText(/Input monitoring/)).toBeInTheDocument();
    });

    it('omits the input monitoring button for a bus track', () => {
        const busTrack = { ...mockTrack, kind: 'bus' as const };
        renderWithTooltip(<TrackHeader track={busTrack} isSelected={true} />);
        expect(screen.queryByLabelText(/Input monitoring/)).not.toBeInTheDocument();
    });
});
