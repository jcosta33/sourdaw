import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AutomationBottomPanel } from '../AutomationBottomPanel';

vi.mock('#/components/daw/DawBlockedState', () => ({
    DawBlockedState: ({ title, description }: { title: string; description: string }) => (
        <div data-testid="blocked-state">
            <span>{title}</span>
            <span>{description}</span>
        </div>
    ),
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title, description }: { title: string; description: string }) => (
        <div data-testid="empty-state">
            <span>{title}</span>
            <span>{description}</span>
        </div>
    ),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ children, compact, className }: { children: React.ReactNode; compact?: boolean; className?: string }) => (
        <div className={className} data-compact={compact}>{children}</div>
    ),
}));

vi.mock('#/components/daw/DawPanelSurface', () => ({
    DawPanelSurface: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('#/modules/Arrangement/presentations/views/BeatRulerBar', () => ({
    BeatRulerBar: () => <div data-testid="beat-ruler">Beat Ruler</div>,
}));

vi.mock('#/modules/Arrangement/presentations/views/TimelineChromeSurface', () => ({
    TimelineChromeSurface: ({ children, className, tone }: { children?: React.ReactNode; className?: string; tone?: string }) => (
        <div className={className} data-tone={tone}>{children}</div>
    ),
}));

vi.mock('#/modules/Automation/useCases/automationStore', () => ({
    automationStore: { value: { lanes: [] } },
}));

vi.mock('#/modules/Arrangement/stores/trackStore', () => ({
    trackStore: { value: { tracks: [], selectedTrackId: null } },
}));

vi.mock('#/modules/Arrangement/stores/timelineViewStore', () => ({
    timelineViewStore: { value: { scrollX: 0, scrollY: 0, pixelsPerBeat: 12, autoScrollEnabled: true } },
    scrollTimeline: vi.fn(),
}));

vi.mock('#/modules/Workspace/stores/workspaceStore', () => ({
    workspaceStore: { value: { trackListOpen: true, trackListWidth: 200 } },
}));

vi.mock('../AutomationView/AutomationLaneRow', () => ({
    AutomationLaneRow: ({ lane }: { lane: { id: string } }) => (
        <div data-testid={`lane-row-${lane.id}`}>Lane {lane.id}</div>
    ),
}));

vi.mock('../AutomationView/AutomationSidebarCell', () => ({
    AutomationSidebarCell: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div className={className}>{children}</div>
    ),
}));

vi.mock('../AutomationView/AutomationControls', () => ({
    AutomationAddLaneControl: ({ params }: { params: { id: string; name: string }[] }) => (
        <div data-testid="add-lane-control">
            {params.map((p) => <span key={p.id}>{p.name}</span>)}
        </div>
    ),
    AutomationModeControl: ({ automationMode, laneCount }: { automationMode: string; laneCount: number }) => (
        <div data-testid="mode-control" data-mode={automationMode} data-count={laneCount} />
    ),
}));

vi.mock('../../helpers/automationViewHelpers', () => ({
    getAutomatableParams: vi.fn(() => [
        { id: 'volume', name: 'Volume' },
        { id: 'pan', name: 'Pan' },
    ]),
    LANE_HEIGHT: 120,
}));

vi.mock('../../../models/AutomationViewTypes', () => ({
    // Type only
}));

vi.mock('#/modules/Automation/useCases/automation/addAutomationLane', () => ({
    addAutomationLane: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases/automation/toggleLaneCollapsed', () => ({
    toggleLaneCollapsed: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases/automation/removeAutomationLane', () => ({
    removeAutomationLane: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/toggleTrackState/setAutomationMode', () => ({
    setAutomationMode: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((store, fallback) => fallback || store.value),
}));

describe('AutomationBottomPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<AutomationBottomPanel />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
    });

    it('should show blocked state when no track is selected', () => {
        render(<AutomationBottomPanel />);
        expect(screen.getByTestId('blocked-state')).toBeInTheDocument();
        expect(screen.getByText('No track selected')).toBeInTheDocument();
    });
});
