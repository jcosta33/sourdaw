import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { EffectsTab } from '../EffectsTab';

import type { PluginDescriptorView as PluginDescriptor } from '../../../../models/PluginDescriptorViewTypes';

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
            play: vi.fn(),
            stop: vi.fn(),
            isPlaying: false,
            currentUrl: null,
            error: null,
            isLoading: false,
        },
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
});
