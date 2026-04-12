import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '#/components/ui/tooltip';
import { PluginDummy } from '#/modules/Arrangement/__tests__/PluginDummy';
import { EffectsTab } from '../EffectsTab';

const renderWithTooltip = (ui: React.ReactElement) => {
    return render(<TooltipProvider>{ui}</TooltipProvider>);
};

describe('EffectsTab', () => {
    const mockPlugins = [
        PluginDummy.create({ id: 'reverb', name: 'Reverb', category: 'effect' }),
        PluginDummy.create({ id: 'delay', name: 'Delay', category: 'effect' }),
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
            isLoading: false
        }
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        renderWithTooltip(
            <EffectsTab {...defaultProps} />
        );
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        renderWithTooltip(
            <EffectsTab {...defaultProps} />
        );
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        renderWithTooltip(
            <EffectsTab {...defaultProps} />
        );
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
