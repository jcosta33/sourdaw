import { type ReactElement, type ReactNode } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { type ReadableStore } from '#/infra/store/types';
import { scrollTimelineViewportFromWheel } from '#/modules/Arrangement/useCases';

import { type Track } from '../../../models/TrackViewTypes';
import { useTracks } from '../../hooks/useTracks';
import { AutomationView } from '../AutomationView';

// Mock hooks
vi.mock('../../hooks/useTracks', () => ({
    useTracks: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(<StoreData,>(_store: ReadableStore<StoreData>, defaultValue: StoreData): StoreData => defaultValue),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    scrollTimelineViewportFromWheel: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    toggleAutomationPanel: vi.fn(),
}));

vi.mock('#/modules/Arrangement/presentations/views', () => ({
    ArrangementBar: () => <div data-testid="arrangement-bar">Arrangement Bar</div>,
}));

vi.mock('../AutomationView/TrackAutomationSection', () => ({
    TrackAutomationSection: ({ trackId, trackName }: { trackId: string; trackName: string }) => (
        <div data-testid={`track-section-${trackId}`}>{trackName}</div>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        'aria-label': ariaLabel,
    }: {
        children: ReactNode;
        onClick?: () => void;
        'aria-label'?: string;
    }): ReactElement => (
        <button onClick={onClick} aria-label={ariaLabel}>
            {children}
        </button>
    ),
}));

const makeTrack = (overrides: Partial<Track>): Track => ({
    id: 'track-1',
    name: 'Track 1',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
    pan: 0,
    color: 'var(--color-palette-steel)',
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
    height: 64,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'main',
    alternatives: [],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    ...overrides,
});

const renderWithTooltip = (ui: ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('AutomationView', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useTracks).mockReturnValue({
            tracks: [],
            selectedTrackId: null,
        });
    });

    it('should render correctly', () => {
        const { container } = renderWithTooltip(<AutomationView />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should render arrangement bar', () => {
        renderWithTooltip(<AutomationView />);
        expect(screen.getByTestId('arrangement-bar')).toBeInTheDocument();
    });

    it('should render track sections when tracks exist', () => {
        vi.mocked(useTracks).mockReturnValue({
            tracks: [
                makeTrack({ id: 'track-1', name: 'Track 1', kind: 'audio' }),
                makeTrack({ id: 'track-2', name: 'Track 2', kind: 'midi' }),
            ],
            selectedTrackId: null,
        });

        renderWithTooltip(<AutomationView />);
        expect(screen.getByTestId('track-section-track-1')).toBeInTheDocument();
        expect(screen.getByTestId('track-section-track-2')).toBeInTheDocument();
    });

    // F7: the wheel handler now reports its own scrollable container's real
    // height (`event.currentTarget.clientHeight`) on every call, rather than
    // letting the Arrangement use case clamp against an unrelated view's
    // reported height. jsdom does no layout, so `clientHeight` is a defined
    // property on the element that must be set explicitly to assert the
    // value genuinely comes from the element — not a hardcoded 0, which
    // would keep passing even if the production code stopped reading it.
    it('should route horizontal wheel movement through the Arrangement scroll use case', () => {
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', name: 'Track 1', kind: 'audio' })],
            selectedTrackId: null,
        });

        renderWithTooltip(<AutomationView />);
        const scrollContainer = screen.getByTestId('track-section-track-1').parentElement as HTMLElement;
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });

        fireEvent.wheel(screen.getByTestId('track-section-track-1'), {
            deltaX: 32,
            deltaY: 4,
            shiftKey: false,
        });

        expect(scrollTimelineViewportFromWheel).toHaveBeenCalledTimes(1);
        expect(scrollTimelineViewportFromWheel).toHaveBeenCalledWith({
            deltaX: 32,
            deltaY: 4,
            shiftKey: false,
            viewportHeight: 400,
        });
    });

    it('should route vertical wheel movement through the Arrangement scroll use case', () => {
        vi.mocked(useTracks).mockReturnValue({
            tracks: [makeTrack({ id: 'track-1', name: 'Track 1', kind: 'audio' })],
            selectedTrackId: null,
        });

        renderWithTooltip(<AutomationView />);
        const scrollContainer = screen.getByTestId('track-section-track-1').parentElement as HTMLElement;
        Object.defineProperty(scrollContainer, 'clientHeight', { value: 400, configurable: true });

        fireEvent.wheel(screen.getByTestId('track-section-track-1'), {
            deltaX: 2,
            deltaY: 36,
            shiftKey: false,
        });

        expect(scrollTimelineViewportFromWheel).toHaveBeenCalledTimes(1);
        expect(scrollTimelineViewportFromWheel).toHaveBeenCalledWith({
            deltaX: 2,
            deltaY: 36,
            shiftKey: false,
            viewportHeight: 400,
        });
    });
});
