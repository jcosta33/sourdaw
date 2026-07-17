import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { vcaGroupStore } from '#/modules/Arrangement/stores';

import { TrackVcaSection } from '../TrackVcaSection';

import type { Track } from '../../../../models/TrackViewTypes';

// Mock external dependencies
const mockAssignToVca = vi.fn<(...args: unknown[]) => void>();
const mockRemoveFromVca = vi.fn<(...args: unknown[]) => void>();
const mockGetVcaGroups = vi.fn<() => Array<{ id: string; name: string; trackIds: string[] }>>(() => []);
const mockCreateVcaGroup = vi.fn<(...args: unknown[]) => void>();
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        assignToVca: (...args: unknown[]) => mockAssignToVca(...args),
        removeFromVca: (...args: unknown[]) => mockRemoveFromVca(...args),
        getVcaGroups: () => mockGetVcaGroups(),
        createVcaGroup: (...args: unknown[]) => mockCreateVcaGroup(...args),
    };
});

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
        sends: [],
        frozen: false,
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
        mockGetVcaGroups.mockReturnValue([]);
        vcaGroupStore.set({ groups: [] });
    });

    const setVcaGroups = (groups: Array<{ id: string; name: string; trackIds: string[] }>): void => {
        mockGetVcaGroups.mockReturnValue(groups);
        vcaGroupStore.set({ groups });
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

    it('should call createVcaGroup when create button is clicked', () => {
        setVcaGroups([]);
        render(<TrackVcaSection track={mockTrack} />);
        fireEvent.click(screen.getByLabelText('Create VCA group'));
        expect(mockCreateVcaGroup).toHaveBeenCalledWith('VCA 1', ['track-1']);
    });

    it('should call assignToVca when VCA group is selected', () => {
        setVcaGroups([{ id: 'vca-1', name: 'VCA 1', trackIds: [] }]);
        render(<TrackVcaSection track={mockTrack} />);
        const select = screen.getByTestId('select');
        fireEvent.change(select, { target: { value: 'vca-1' } });
        expect(mockAssignToVca).toHaveBeenCalledWith('track-1', 'vca-1');
    });

    it('should call removeFromVca when "None" is selected', () => {
        const trackWithVca = { ...mockTrack, vcaGroupId: 'vca-1' };
        setVcaGroups([{ id: 'vca-1', name: 'VCA 1', trackIds: ['track-1'] }]);
        render(<TrackVcaSection track={trackWithVca} />);
        const select = screen.getByTestId('select');
        fireEvent.change(select, { target: { value: '' } });
        expect(mockRemoveFromVca).toHaveBeenCalledWith('track-1');
    });

    it('should render surface card', () => {
        render(<TrackVcaSection track={mockTrack} />);
        expect(screen.getByTestId('surface-card')).toBeInTheDocument();
    });
});
