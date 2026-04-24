import type { ReactNode } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { togglePlayback } from '#/modules/Transport/useCases/transportControls/togglePlayback';

import { TransportBar } from '../TransportBar';

// Mock hooks
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn<typeof useStore>(),
}));

vi.mock('../../hooks/useTransportState', () => ({
    useTransportState: vi.fn(() => ({
        isPlaying: false,
        isRecording: false,
        isLooping: false,
        playheadPosition: 0,
        togglePlay: vi.fn<() => void>(),
        toggleRecord: vi.fn<() => void>(),
        toggleLoop: vi.fn<() => void>(),
        stop: vi.fn<() => void>(),
        seekToStart: vi.fn<() => void>(),
    })),
}));

vi.mock('#/modules/Transport/useCases/transportControls/togglePlayback', () => ({
    togglePlayback: vi.fn<typeof togglePlayback>(),
}));

// Mock child components
vi.mock('../Transport/PlayheadDisplay', () => ({
    PlayheadDisplay: () => <div data-testid="playhead-display">0:0:0</div>,
}));

vi.mock('../Transport/AutoScrollToggle', () => ({
    AutoScrollToggle: () => <button data-testid="autoscroll-toggle">AutoScroll</button>,
}));

vi.mock('../Transport/PanelToggles', () => ({
    PanelToggles: () => <div data-testid="panel-toggles">Toggles</div>,
}));

vi.mock('../TempoEditor', () => ({
    TempoEditor: () => <div data-testid="tempo-editor">Tempo</div>,
}));

vi.mock('#/components/daw/DawInlineHint', () => ({
    DawInlineHint: ({ children }: { children: ReactNode }) => <div data-testid="inline-hint">{children}</div>,
}));

describe('TransportBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useStore).mockImplementation((store, defaultValue) => {
            return (defaultValue ?? {}) as typeof defaultValue;
        });
    });

    it('should render correctly', () => {
        const { container } = render(<TransportBar />);
        expect(container.firstChild).toBeTruthy();
    });

    it('should show play button', () => {
        render(<TransportBar />);
        expect(screen.getByRole('button', { name: /Play/i })).toBeInTheDocument();
    });

    it('should call togglePlay when play button is clicked', () => {
        render(<TransportBar />);
        const playButton = screen.getByRole('button', { name: /Play/i });
        fireEvent.click(playButton);
        expect(togglePlayback).toHaveBeenCalled();
    });
});
