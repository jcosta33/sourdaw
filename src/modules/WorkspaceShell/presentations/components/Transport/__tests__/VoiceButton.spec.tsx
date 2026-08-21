import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { VoiceButton } from '../VoiceButton';

describe('VoiceButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should hide when voice input is unavailable', () => {
        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton isAvailable={false} isListening={false} isTranscribing={false} onToggle={vi.fn()} />
            </TooltipProvider>
        );

        expect(screen.queryByRole('button', { name: /Voice command/ })).not.toBeInTheDocument();
    });

    it('should render the idle state when voice input is available', () => {
        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton isAvailable={true} isListening={false} isTranscribing={false} onToggle={vi.fn()} />
            </TooltipProvider>
        );

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
        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton isAvailable={true} {...voiceState} onToggle={vi.fn()} />
            </TooltipProvider>
        );

        fireEvent.pointerMove(screen.getByRole('button'));

        expect(await screen.findByText(tooltip)).toBeInTheDocument();
    });

    it.each([
        { isListening: true, isTranscribing: false },
        { isListening: false, isTranscribing: true },
    ])('should render the active state for listening or transcribing voice input', (voiceState) => {
        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton isAvailable={true} {...voiceState} onToggle={vi.fn()} />
            </TooltipProvider>
        );

        const button = screen.getByRole('button', { name: 'Stop voice command' });
        expect(button).toHaveAttribute('aria-pressed', 'true');
    });

    it('passes the native browser event to the admission callback when clicked', () => {
        const onToggle = vi.fn();

        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton isAvailable={true} isListening={false} isTranscribing={false} onToggle={onToggle} />
            </TooltipProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: /Voice command/ }));

        expect(onToggle).toHaveBeenCalledWith(expect.any(Event));
    });
});
