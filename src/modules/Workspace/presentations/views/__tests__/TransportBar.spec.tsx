import type { ReactNode } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { useStore } from '#/infra/store/useStore';
import { voiceStatusStore } from '#/modules/AiRuntime/stores';
import { togglePlayback } from '#/modules/Transport/useCases/transportControls/togglePlayback';

import { TransportBar } from '../TransportBar';

const voiceRuntimeMocks = vi.hoisted(() => ({
    isVoiceInputAvailable: vi.fn<() => boolean>(),
    toggleVoiceInput: vi.fn<() => void>(),
}));

// Mock hooks
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn<typeof useStore>(),
}));

vi.mock('#/modules/AiRuntime/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AiRuntime/useCases')>()),
    isVoiceInputAvailable: voiceRuntimeMocks.isVoiceInputAvailable,
    toggleVoiceInput: voiceRuntimeMocks.toggleVoiceInput,
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

let voiceStatus = { isListening: false, transcribing: false };

describe('TransportBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        voiceStatus = { isListening: false, transcribing: false };
        voiceRuntimeMocks.isVoiceInputAvailable.mockReturnValue(false);
        vi.mocked(useStore).mockImplementation((store, defaultValue) => {
            if (store === voiceStatusStore) {
                return voiceStatus;
            }

            return (defaultValue ?? {}) as typeof defaultValue;
        });
    });

    const renderTransportBar = () =>
        render(
            <TooltipProvider delayDuration={0}>
                <TransportBar />
            </TooltipProvider>
        );

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

    it('should hide VoiceButton when AiRuntime reports unavailable voice input', () => {
        renderTransportBar();

        expect(voiceRuntimeMocks.isVoiceInputAvailable).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('button', { name: /Voice command/ })).not.toBeInTheDocument();
    });

    it('should pass transcribing status and zero-argument toggle ownership into VoiceButton', () => {
        voiceRuntimeMocks.isVoiceInputAvailable.mockReturnValue(true);
        voiceStatus = { isListening: false, transcribing: true };

        renderTransportBar();

        const voiceButton = screen.getByRole('button', { name: 'Stop voice command' });
        expect(voiceButton).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(voiceButton);

        expect(voiceRuntimeMocks.toggleVoiceInput).toHaveBeenCalledWith();
    });
});
