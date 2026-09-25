import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { VoiceButton, type VoiceSetupStatus } from '../VoiceButton';

const renderVoiceButton = ({
    isAvailable = true,
    isListening = false,
    isTranscribing = false,
    setupStatus = null,
    onToggle = vi.fn(),
    onEnableVoice = vi.fn(),
}: {
    isAvailable?: boolean;
    isListening?: boolean;
    isTranscribing?: boolean;
    setupStatus?: VoiceSetupStatus | null;
    onToggle?: (event: Event) => void;
    onEnableVoice?: () => void;
} = {}) => {
    render(
        <TooltipProvider delayDuration={0}>
            <VoiceButton
                isAvailable={isAvailable}
                isListening={isListening}
                isTranscribing={isTranscribing}
                onToggle={onToggle}
                setupStatus={setupStatus}
                onEnableVoice={onEnableVoice}
            />
        </TooltipProvider>
    );
    return { onToggle, onEnableVoice };
};

describe('VoiceButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should hide when voice input is unavailable and no setup affordance exists', () => {
        renderVoiceButton({ isAvailable: false, setupStatus: null });

        expect(screen.queryByRole('button', { name: /Voice command/ })).not.toBeInTheDocument();
        expect(screen.queryByTestId('voice-setup-button')).not.toBeInTheDocument();
    });

    it('should render the idle state when voice input is available', () => {
        renderVoiceButton({ isAvailable: true });

        const button = screen.getByRole('button', { name: 'Voice command (hold V)' });
        expect(button).toHaveAttribute('aria-pressed', 'false');
    });

    it.each([
        {
            isListening: false,
            isTranscribing: false,
            tooltip: 'Voice command (hold V)',
        },
        {
            isListening: true,
            isTranscribing: false,
            tooltip: /Listening.*click to stop/,
        },
    ])('should preserve the tooltip copy', async ({ tooltip, ...voiceState }) => {
        renderVoiceButton({ isAvailable: true, ...voiceState });

        fireEvent.pointerMove(screen.getByRole('button'));

        expect(await screen.findByText(tooltip)).toBeInTheDocument();
    });

    it.each([
        { isListening: true, isTranscribing: false },
        { isListening: false, isTranscribing: true },
    ])('should render the active state for listening or transcribing voice input', (voiceState) => {
        renderVoiceButton({ isAvailable: true, ...voiceState });

        const button = screen.getByRole('button', { name: 'Stop voice command' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('passes the native browser event to the admission callback when clicked', () => {
        const onToggle = vi.fn();

        renderVoiceButton({ isAvailable: true, onToggle });

        fireEvent.click(screen.getByRole('button', { name: /Voice command/ }));

        expect(onToggle).toHaveBeenCalledWith(expect.any(Event));
    });

    it('renders the enable-voice affordance when the desktop model is missing', () => {
        renderVoiceButton({ isAvailable: false, setupStatus: { state: 'missing' } });

        expect(screen.getByTestId('voice-setup-button')).toBeInTheDocument();
        expect(screen.queryByTestId('voice-command-button')).not.toBeInTheDocument();
    });

    it('discloses the download and turns the confirmation click into the consent gesture', async () => {
        const onEnableVoice = vi.fn();
        renderVoiceButton({ isAvailable: false, setupStatus: { state: 'missing' }, onEnableVoice });

        fireEvent.click(screen.getByTestId('voice-setup-button'));

        expect(
            await screen.findByText(
                /Downloads and verifies the Whisper speech model \(~148 MB\) for private on-device transcription\./
            )
        ).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('voice-setup-download-button'));

        expect(onEnableVoice).toHaveBeenCalledOnce();
    });

    it('shows download progress while the model downloads', () => {
        renderVoiceButton({ isAvailable: false, setupStatus: { state: 'downloading', progress: 0.42 } });

        expect(screen.getByTestId('voice-setup-progress')).toHaveTextContent('42%');
    });

    it('shows the failure message and a retry affordance after a failed download', async () => {
        const onEnableVoice = vi.fn();
        renderVoiceButton({
            isAvailable: false,
            setupStatus: { state: 'error', message: 'Whisper model download failed: HTTP 503' },
            onEnableVoice,
        });

        fireEvent.click(screen.getByTestId('voice-setup-button'));

        expect(await screen.findByTestId('voice-setup-error')).toHaveTextContent('HTTP 503');

        fireEvent.click(screen.getByTestId('voice-setup-retry-button'));

        expect(onEnableVoice).toHaveBeenCalledOnce();
    });

    it('keeps the ready-state button when voice input is available regardless of setup state', () => {
        renderVoiceButton({ isAvailable: true, setupStatus: { state: 'missing' } });

        expect(screen.getByTestId('voice-command-button')).toBeInTheDocument();
        expect(screen.queryByTestId('voice-setup-button')).not.toBeInTheDocument();
    });
});
