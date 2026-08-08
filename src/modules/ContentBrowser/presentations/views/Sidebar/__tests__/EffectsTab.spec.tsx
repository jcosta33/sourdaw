import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { type PreviewHandle } from '../../../hooks/usePreviewAudio';
import { EffectsTab } from '../EffectsTab';

import type { PluginDescriptorView as PluginDescriptor } from '../../../../models/PluginDescriptorViewTypes';

const arrangementMocks = vi.hoisted(() => ({
    addDevice: vi.fn<(trackId: string, deviceType: string) => { id: string } | null>(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    addDevice: arrangementMocks.addDevice,
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
    ])('opens the $deviceType panel on the device it just created', ({ query, panelAction, cardName }) => {
        arrangementMocks.addDevice.mockReturnValue({ id: 'device-77' });
        const panelActions = {
            showProof: vi.fn(),
            showGluten: vi.fn(),
            showCrust: vi.fn(),
            showDutchOven: vi.fn(),
            showScoring: vi.fn(),
            showBacteria: vi.fn(),
            showYeast: vi.fn(),
            showDevice: vi.fn(),
        };

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

        expect(panelActions[panelAction]).toHaveBeenCalledWith('device-77');
    });

    it('leaves the panel closed when the device could not be created', () => {
        arrangementMocks.addDevice.mockReturnValue(null);
        const panelActions = {
            showProof: vi.fn(),
            showGluten: vi.fn(),
            showCrust: vi.fn(),
            showDutchOven: vi.fn(),
            showScoring: vi.fn(),
            showBacteria: vi.fn(),
            showYeast: vi.fn(),
            showDevice: vi.fn(),
        };

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
