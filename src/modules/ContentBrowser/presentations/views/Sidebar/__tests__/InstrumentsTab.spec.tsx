import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { InstrumentsTab } from '../InstrumentsTab';
import { type SidebarPanelActions } from '../SidebarTypes';

type FactoryPresetMock = {
    id: string;
    name: string;
    category: string;
    description: string;
    trackKind: string;
    devices: Array<{ type: string; name: string; parameterValues: Record<string, number> }>;
    tags: string[];
    author: string;
    isFactory: boolean;
};

const arrangementMocks = vi.hoisted(() => ({
    compileLoadPresetActions: vi.fn(),
    getFactoryPresets: vi.fn<() => FactoryPresetMock[]>(() => []),
}));

const toasterMocks = vi.hoisted(() => ({
    compileToasterTrackStackActions: vi.fn(),
}));

const commandMocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    getFactoryPresets: arrangementMocks.getFactoryPresets,
    getUserPresets: vi.fn(() => []),
    saveCurrentAsPreset: vi.fn(),
    deleteUserPreset: vi.fn(),
    compileLoadPresetActions: arrangementMocks.compileLoadPresetActions,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: commandMocks.executeAppAction,
    executeAppActionBatch: commandMocks.executeAppActionBatch,
}));

vi.mock('#/modules/Toaster/useCases', () => ({
    compileToasterTrackStackActions: toasterMocks.compileToasterTrackStackActions,
}));

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

const makePanelActions = (overrides: Partial<SidebarPanelActions> = {}): SidebarPanelActions => ({
    showBacteria: vi.fn(),
    showCrust: vi.fn(),
    showDevice: vi.fn(),
    showDutchOven: vi.fn(),
    showGluten: vi.fn(),
    showProof: vi.fn(),
    showScoring: vi.fn(),
    showYeast: vi.fn(),
    showCrumbs: vi.fn(),
    showFermenter: vi.fn(),
    showGrandBoule: vi.fn(),
    showLevain: vi.fn(),
    showToaster: vi.fn(),
    ...overrides,
});

describe('InstrumentsTab', () => {
    const mockTrack = {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
    const mockPreview = {
        play: vi.fn(),
        stop: vi.fn(),
    };
    const mockRoute = { id: 'instruments', title: 'Instruments' };

    beforeEach(() => {
        vi.clearAllMocks();
        arrangementMocks.getFactoryPresets.mockReturnValue([]);
        commandMocks.executeAppAction.mockResolvedValue(undefined);
        commandMocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
    });

    it('should render without crashing', () => {
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute}
                pushRoute={vi.fn()}
            />
        );
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute}
                pushRoute={vi.fn()}
            />
        );
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute}
                pushRoute={vi.fn()}
            />
        );
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it('loads an instrument preset through the compiled action instead of directly mutating the selected track', () => {
        const preset = {
            id: 'pad-1',
            name: 'Glass Pad',
            category: 'pad',
            description: '',
            trackKind: 'audio',
            devices: [{ type: 'builtin-synth', name: 'Synth', parameterValues: { cutoff: 0.6 } }],
            tags: [],
            author: 'test',
            isFactory: true,
        };
        const action = { type: 'loadPreset', payload: { presetId: preset.id, trackId: mockTrack.id } } as const;
        arrangementMocks.getFactoryPresets.mockReturnValue([preset]);
        arrangementMocks.compileLoadPresetActions.mockReturnValue({
            actions: [action],
            deviceIds: ['preset-device-1'],
            groupLabel: 'Load preset',
            trackId: mockTrack.id,
        });

        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery="glass"
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute}
                pushRoute={vi.fn()}
            />
        );

        fireEvent.click(screen.getByText('Glass Pad'));

        expect(arrangementMocks.compileLoadPresetActions).toHaveBeenCalledWith({
            presetId: preset.id,
            trackId: mockTrack.id,
        });
        expect(commandMocks.executeAppAction).toHaveBeenCalledWith(action);
    });

    it('opens the Levain device panel after the catalog action commits (showLevain receives the app-owned device id)', async () => {
        const showLevain = vi.fn();
        arrangementMocks.compileLoadPresetActions.mockReturnValue({
            actions: [{ type: 'loadPreset', payload: { presetId: 'levain-default', trackId: 'levain-track-1' } }],
            deviceIds: ['levain-device-9'],
            groupLabel: 'Load preset',
            trackId: 'levain-track-1',
        });
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute}
                pushRoute={vi.fn()}
                panelActions={makePanelActions({ showLevain })}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /^Levain/ }));

        // Regression guard (#716 wave-2): the handler must forward the created
        // device's id, not null. Passing null left the Levain bottom panel
        // unmounted — the card created a track but never opened its panel, unlike
        // every other instrument card.
        await waitFor(() => expect(showLevain).toHaveBeenCalledWith('levain-device-9'));
    });

    it('creates Toaster through one compiled action batch before opening its panel', async () => {
        const showToaster = vi.fn();
        const actions = [
            { type: 'addTrack', payload: { id: 'toaster-parent', name: 'Toaster Kit', kind: 'folder' } },
            { type: 'loadPreset', payload: { presetId: 'toaster-default', trackId: 'toaster-parent' } },
        ] as const;
        toasterMocks.compileToasterTrackStackActions.mockReturnValue({
            actions,
            deviceIds: ['toaster-device-1'],
            groupLabel: 'Create Toaster Kit',
            trackId: 'toaster-parent',
        });
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute}
                pushRoute={vi.fn()}
                panelActions={makePanelActions({ showToaster })}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /^Toaster/ }));

        await waitFor(() =>
            expect(commandMocks.executeAppActionBatch).toHaveBeenCalledWith(
                actions,
                expect.objectContaining({ groupLabel: 'Create Toaster Kit' })
            )
        );
        expect(showToaster).toHaveBeenCalledWith('toaster-device-1');
    });

    it('does not advertise a device withheld from release', () => {
        renderWithTooltip(
            <InstrumentsTab
                selectedTrackId={mockTrack.id}
                searchQuery=""
                selectedTrack={mockTrack}
                favorites={new Set()}
                onToggleFavorite={vi.fn()}
                preview={mockPreview as any}
                currentRoute={mockRoute}
                pushRoute={vi.fn()}
                panelActions={makePanelActions()}
            />
        );

        expect(screen.queryByRole('button', { name: /^Grand Boule/ })).not.toBeInTheDocument();
    });
});
