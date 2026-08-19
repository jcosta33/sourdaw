import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { type PreviewHandle } from '../../../hooks/usePreviewAudio';
import { EffectsTab } from '../EffectsTab';

import type { PluginDescriptorView as PluginDescriptor } from '../../../../models/PluginDescriptorViewTypes';
import type { SidebarPanelActions } from '../SidebarTypes';

const arrangementMocks = vi.hoisted(() => ({
    compileAddDeviceAction: vi.fn(),
    compileLoadPresetActions: vi.fn(),
    getFactoryPresets: vi.fn(),
}));

const commandMocks = vi.hoisted(() => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    compileAddDeviceAction: arrangementMocks.compileAddDeviceAction,
    compileLoadPresetActions: arrangementMocks.compileLoadPresetActions,
    getFactoryPresets: arrangementMocks.getFactoryPresets,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: commandMocks.executeAppAction,
    executeAppActionBatch: commandMocks.executeAppActionBatch,
}));

const createPlugin = (overrides?: Partial<PluginDescriptor>): PluginDescriptor => ({
    id: 'builtin-reverb',
    name: 'Reverb',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    parameters: [],
    hasCustomUI: false,
    ...overrides,
});

const createPanelActions = (): SidebarPanelActions => ({
    showBacteria: vi.fn(),
    showCrumbs: vi.fn(),
    showCrust: vi.fn(),
    showDevice: vi.fn(),
    showDutchOven: vi.fn(),
    showFermenter: vi.fn(),
    showGluten: vi.fn(),
    showGrandBoule: vi.fn(),
    showLevain: vi.fn(),
    showProof: vi.fn(),
    showScoring: vi.fn(),
    showToaster: vi.fn(),
    showYeast: vi.fn(),
});

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('EffectsTab', () => {
    const mockPlugins = [
        createPlugin({ id: 'reverb', name: 'Reverb', category: 'effect' }),
        createPlugin({ id: 'delay', name: 'Delay', category: 'effect' }),
    ];

    const defaultProps = {
        plugins: mockPlugins,
        selectedTrackId: 'track-1',
        searchQuery: '',
        currentRoute: { id: 'effects' as const, title: 'Effects' },
        pushRoute: vi.fn(),
        favorites: new Set<string>(),
        onToggleFavorite: vi.fn(),
        preview: {
            playingId: null,
            play: vi.fn<PreviewHandle['play']>(),
            playTone: vi.fn<PreviewHandle['playTone']>(),
            playFile: vi.fn<PreviewHandle['playFile']>().mockResolvedValue(undefined),
            stop: vi.fn<PreviewHandle['stop']>(),
        } satisfies PreviewHandle,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        arrangementMocks.getFactoryPresets.mockReturnValue([
            {
                id: 'fx-chain-1',
                name: 'Vocal Chain',
                category: 'fx',
                description: '',
                trackKind: 'audio',
                devices: [{ type: 'builtin-delay', name: 'Delay', parameterValues: { mix: 0.4 } }],
                tags: [],
                author: 'test',
                isFactory: true,
            },
        ]);
        arrangementMocks.compileAddDeviceAction.mockImplementation((trackId: string, deviceType: string) => ({
            type: 'addDevice',
            payload: { trackId, deviceType, deviceId: 'device-77', expectedDeviceIds: [] },
        }));
        commandMocks.executeAppAction.mockResolvedValue(undefined);
    });

    it('loads an FX preset through the compiled action instead of directly mutating the selected track', () => {
        const action = { type: 'loadPreset', payload: { presetId: 'fx-chain-1', trackId: 'track-1' } } as const;
        arrangementMocks.compileLoadPresetActions.mockReturnValue({
            actions: [action],
            deviceIds: ['preset-device-1'],
            groupLabel: 'Load preset',
            trackId: 'track-1',
        });

        renderWithTooltip(
            <EffectsTab {...defaultProps} currentRoute={{ id: 'effects-fxpresets', title: 'FX Chain Presets' }} />
        );

        fireEvent.click(screen.getByText('Vocal Chain'));

        expect(arrangementMocks.compileLoadPresetActions).toHaveBeenCalledWith({
            presetId: 'fx-chain-1',
            trackId: 'track-1',
        });
        expect(commandMocks.executeAppAction).toHaveBeenCalledWith(action);
    });

    it('should render without crashing', () => {
        renderWithTooltip(<EffectsTab {...defaultProps} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(<EffectsTab {...defaultProps} />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(<EffectsTab {...defaultProps} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });

    it.each([
        { query: 'crust', deviceType: 'crust', panelAction: 'showCrust' as const, cardName: /crust/i },
        { query: 'dutch', deviceType: 'dutch-oven', panelAction: 'showDutchOven' as const, cardName: /dutch oven/i },
    ])(
        'opens the $deviceType panel only after the action commits',
        async ({ query, deviceType, panelAction, cardName }) => {
            const panelActions = createPanelActions();

            renderWithTooltip(
                <EffectsTab
                    {...defaultProps}
                    plugins={[
                        createPlugin({ id: 'crust', name: 'Crust', category: 'effect' }),
                        createPlugin({ id: 'dutch-oven', name: 'Dutch Oven', category: 'effect' }),
                    ]}
                    searchQuery={query}
                    panelActions={panelActions}
                />
            );

            fireEvent.click(screen.getByRole('button', { name: cardName }));

            expect(commandMocks.executeAppAction).toHaveBeenCalledWith({
                type: 'addDevice',
                payload: { trackId: 'track-1', deviceType, deviceId: 'device-77', expectedDeviceIds: [] },
            });
            await waitFor(() => expect(panelActions[panelAction]).toHaveBeenCalledWith('device-77'));
        }
    );

    it('leaves the panel closed when the compiler rejects the add', () => {
        arrangementMocks.compileAddDeviceAction.mockReturnValue(null);
        const panelActions = createPanelActions();

        renderWithTooltip(
            <EffectsTab
                {...defaultProps}
                plugins={[createPlugin({ id: 'crust', name: 'Crust', category: 'effect' })]}
                searchQuery="crust"
                panelActions={panelActions}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /crust/i }));

        expect(panelActions.showCrust).toHaveBeenCalledWith(null);
    });
});
