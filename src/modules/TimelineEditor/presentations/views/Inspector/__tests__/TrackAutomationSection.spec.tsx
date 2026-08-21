import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TrackAutomationSection } from '../TrackAutomationSection';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockGetBuiltinPlugins = vi.fn(() => []);
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        getBuiltinPlugins: () => mockGetBuiltinPlugins(),
    };
});

const mockAddAutomationLane = vi.fn();
const mockToggleAutomationVisibility = vi.fn();
const mockRemoveAutomationLane = vi.fn();
vi.mock('#/modules/Automation/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Automation/useCases')>();
    return {
        ...actual,
        addAutomationLane: (...args: unknown[]) => mockAddAutomationLane(...args),
        toggleAutomationVisibility: (...args: unknown[]) => mockToggleAutomationVisibility(...args),
        removeAutomationLane: (...args: unknown[]) => mockRemoveAutomationLane(...args),
    };
});

type AutomationLaneFixture = {
    id: string;
    trackId: string;
    parameterId: string;
    parameterName: string;
    visible: boolean;
};
const mockUseStore = vi.fn((_store: unknown, _defaultState: unknown): { lanes: AutomationLaneFixture[] } => ({
    lanes: [],
}));
vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: unknown, defaultState: unknown) => mockUseStore(store, defaultState),
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
        <div data-testid="header-band">
            <span>{title}</span>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuSectionLabel: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="menu-label">{children}</div>
    ),
    DawMenuSeparator: () => <hr data-testid="menu-separator" />,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        variant,
        size,
        asChild: _asChild,
        ...props
    }: React.ComponentProps<'button'> & { variant?: string; size?: string; asChild?: boolean }) => (
        <button type="button" data-testid="button" data-variant={variant} data-size={size} {...props}>
            {children}
        </button>
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

describe('TrackAutomationSection', () => {
    const mockTrack: Track = {
        id: 'track-1',
        name: 'Test Track',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        midiFx: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 100,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockUseStore.mockReturnValue({ lanes: [] });
    });

    it('should render without crashing', () => {
        render(<TrackAutomationSection track={mockTrack} />);
        expect(screen.getByText('Automation')).toBeInTheDocument();
    });

    it('should show empty state when no automation lanes exist', () => {
        render(<TrackAutomationSection track={mockTrack} />);
        expect(screen.getByText(/No automation lanes yet/i)).toBeInTheDocument();
    });

    it('should render add button', () => {
        render(<TrackAutomationSection track={mockTrack} />);
        expect(screen.getByLabelText(/Add automation lane/i)).toBeInTheDocument();
    });

    it('should render automation lanes when they exist', () => {
        mockUseStore.mockReturnValue({
            lanes: [{ id: 'lane-1', trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain', visible: true }],
        });
        render(<TrackAutomationSection track={mockTrack} />);
        expect(screen.getByText('Gain')).toBeInTheDocument();
    });

    it('should render show/hide button for each lane', () => {
        mockUseStore.mockReturnValue({
            lanes: [{ id: 'lane-1', trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain', visible: true }],
        });
        render(<TrackAutomationSection track={mockTrack} />);
        expect(screen.getByLabelText('Hide')).toBeInTheDocument();
    });

    it('should render remove button for each lane', () => {
        mockUseStore.mockReturnValue({
            lanes: [{ id: 'lane-1', trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain', visible: true }],
        });
        render(<TrackAutomationSection track={mockTrack} />);
        expect(screen.getByLabelText('Remove lane')).toBeInTheDocument();
    });

    it('should call toggleAutomationVisibility when show/hide is clicked', () => {
        mockUseStore.mockReturnValue({
            lanes: [{ id: 'lane-1', trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain', visible: true }],
        });
        render(<TrackAutomationSection track={mockTrack} />);
        fireEvent.click(screen.getByLabelText('Hide'));
        expect(mockToggleAutomationVisibility).toHaveBeenCalledWith('lane-1');
    });

    it('should call removeAutomationLane when remove is clicked', () => {
        mockUseStore.mockReturnValue({
            lanes: [{ id: 'lane-1', trackId: 'track-1', parameterId: 'gain', parameterName: 'Gain', visible: true }],
        });
        render(<TrackAutomationSection track={mockTrack} />);
        fireEvent.click(screen.getByLabelText('Remove lane'));
        expect(mockRemoveAutomationLane).toHaveBeenCalledWith('lane-1');
    });
});
