import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { setWorkspaceMode } from '../../../useCases/setWorkspaceMode';
import { ClipView } from '../ClipView';

vi.mock('#/components/ui/button', () => ({
    Button: ({ children, onClick, variant, size, className }: any) => (
        <button type="button" onClick={onClick} data-variant={variant} data-size={size} className={className}>
            {children}
        </button>
    ),
}));

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title, description, action }: any) => (
        <div data-testid="blocked-state">
            <span>{title}</span>
            <span>{description}</span>
            {action}
        </div>
    ),
}));

vi.mock('#/components/daw/DawControlStrip', () => ({
    DawControlStrip: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('#/components/daw/DawPanelSurface', () => ({
    DawPanelSurface: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(() => ({ tracks: [], selectedTrackId: null })),
}));

vi.mock('../../../useCases/setWorkspaceMode', () => ({
    setWorkspaceMode: vi.fn(),
}));

vi.mock('../../../useCases/togglePanel/panelToggles/selectClip', () => ({
    selectClip: vi.fn(),
}));

vi.mock('../../../stores/workspaceStore', () => ({
    workspaceStore: { value: { selectedClipId: null } },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, fallback) => fallback || store.value),
}));

vi.mock('../../../models/WorkspaceState', () => ({
    defaultWorkspaceState: { selectedClipId: null },
}));

vi.mock('../ClipView/PianoRoll', () => ({
    PianoRoll: () => <div data-testid="piano-roll">Piano Roll</div>,
}));

vi.mock('../ClipView/WaveformEditor', () => ({
    WaveformEditor: () => <div data-testid="waveform-editor">Waveform Editor</div>,
}));

vi.mock('../ClipView/AutomationLane', () => ({
    AutomationLane: () => <div data-testid="automation-lane">Automation Lane</div>,
}));

vi.mock('../ClipView/KneadEditor', () => ({
    KneadEditor: () => <div data-testid="knead-editor">Knead Editor</div>,
}));

vi.mock('../ClipEditorTray', () => ({
    ClipEditorTray: ({ children }: any) => <div>{children}</div>,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('ClipView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(<ClipView />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
    });

    it('should show blocked state when no track is selected', () => {
        renderWithTooltip(<ClipView />);
        expect(screen.getByText('Select a track to edit clips')).toBeInTheDocument();
    });

    it('should call setWorkspaceMode when back button is clicked', () => {
        renderWithTooltip(<ClipView />);
        fireEvent.click(screen.getByText('Back to Arrange'));
        expect(setWorkspaceMode).toHaveBeenCalledWith('arrange');
    });
});
