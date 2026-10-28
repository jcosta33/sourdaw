import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { vcaGroupStore } from '#/modules/Arrangement/stores';

import { TrackVcaSection } from '../TrackVcaSection';

import type { Track } from '../../../../models/TrackViewTypes';

const mockExecuteUserAppAction = vi.fn<(...args: unknown[]) => Promise<void>>();
vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: (...args: unknown[]) => mockExecuteUserAppAction(...args),
}));

vi.mock('#/components/daw/DawCompactSelect', () => ({
    DawCompactSelect: ({
        value,
        onChange,
        children,
    }: {
        value: string;
        onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
        children: React.ReactNode;
    }) => (
        <select data-testid="select" value={value} onChange={onChange}>
            {children}
        </select>
    ),
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
        <div data-testid="header-band">
            <span>{title}</span>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        onClick,
        'aria-label': ariaLabel,
    }: {
        children: React.ReactNode;
        onClick?: () => void;
        'aria-label'?: string;
    }) => (
        <button data-testid="button" aria-label={ariaLabel} onClick={onClick}>
            {children}
        </button>
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

describe('TrackVcaSection', () => {
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
        mockExecuteUserAppAction.mockResolvedValue(undefined);
        vcaGroupStore.set({ groups: [] });
    });

    const setVcaGroups = (groups: Array<{ id: string; name: string; trackIds: string[] }>): void => {
        vcaGroupStore.set({ groups: groups.map((group) => ({ ...group, gain: 1, muted: false })) });
    };

    it('should render without crashing', () => {
        render(<TrackVcaSection track={mockTrack} />);
        expect(screen.getByText('VCA Group')).toBeInTheDocument();
    });

    it('should render VCA group select', () => {
        render(<TrackVcaSection track={mockTrack} />);
        expect(screen.getByTestId('select')).toBeInTheDocument();
    });

    it('should show "None" option', () => {
        render(<TrackVcaSection track={mockTrack} />);
        expect(screen.getByText('None')).toBeInTheDocument();
    });

    it('should render create VCA button', () => {
        render(<TrackVcaSection track={mockTrack} />);
        expect(screen.getByLabelText('Create VCA group')).toBeInTheDocument();
    });

    it('should display available VCA groups', () => {
        setVcaGroups([
            { id: 'vca-1', name: 'VCA 1', trackIds: [] },
            { id: 'vca-2', name: 'VCA 2', trackIds: [] },
        ]);
        render(<TrackVcaSection track={mockTrack} />);
        expect(screen.getByText('VCA 1')).toBeInTheDocument();
        expect(screen.getByText('VCA 2')).toBeInTheDocument();
    });

    it('dispatches createVcaGroup with the next generated name', () => {
        setVcaGroups([]);
        render(<TrackVcaSection track={mockTrack} />);
        fireEvent.click(screen.getByLabelText('Create VCA group'));
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith(
            {
                type: 'createVcaGroup',
                payload: { name: 'VCA 1', trackIds: ['track-1'] },
            },
            { shouldExecute: expect.any(Function) }
        );
    });

    it('dispatches assignToVca when a group is selected', () => {
        setVcaGroups([{ id: 'vca-1', name: 'VCA 1', trackIds: [] }]);
        render(<TrackVcaSection track={mockTrack} />);
        const select = screen.getByTestId('select');
        fireEvent.change(select, { target: { value: 'vca-1' } });
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith(
            {
                type: 'assignToVca',
                payload: { trackId: 'track-1', vcaGroupId: 'vca-1' },
            },
            { shouldExecute: expect.any(Function) }
        );
    });

    it('dispatches removeFromVca when "None" is selected', () => {
        const trackWithVca = { ...mockTrack, vcaGroupId: 'vca-1' };
        setVcaGroups([{ id: 'vca-1', name: 'VCA 1', trackIds: ['track-1'] }]);
        render(<TrackVcaSection track={trackWithVca} />);
        const select = screen.getByTestId('select');
        fireEvent.change(select, { target: { value: '' } });
        expect(mockExecuteUserAppAction).toHaveBeenCalledWith(
            {
                type: 'removeFromVca',
                payload: { trackId: 'track-1' },
            },
            { shouldExecute: expect.any(Function) }
        );
    });

    it('should render surface card', () => {
        render(<TrackVcaSection track={mockTrack} />);
        expect(screen.getByTestId('surface-card')).toBeInTheDocument();
    });
});
