import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { VoiceButton } from '../VoiceButton';

const voiceButtonMocks = vi.hoisted(() => ({
    isVoiceInputAvailable: vi.fn(),
    toggleVoiceInput: vi.fn(),
    voiceStatus: {
        current: { isListening: false, transcribing: false },
    },
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: () => voiceButtonMocks.voiceStatus.current,
}));

vi.mock('#/modules/AiRuntime/stores', () => ({
    voiceStatusStore: {},
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    isVoiceInputAvailable: voiceButtonMocks.isVoiceInputAvailable,
    toggleVoiceInput: voiceButtonMocks.toggleVoiceInput,
}));

describe('VoiceButton', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        voiceButtonMocks.voiceStatus.current = { isListening: false, transcribing: false };
        voiceButtonMocks.isVoiceInputAvailable.mockReturnValue(false);
    });

    it('should render when AiRuntime reports browser voice input availability', () => {
        voiceButtonMocks.isVoiceInputAvailable.mockReturnValue(true);

        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton />
            </TooltipProvider>
        );

        expect(screen.getByRole('button', { name: 'Voice command (hold V)' })).toBeInTheDocument();
    });

    it('should hide when AiRuntime reports no voice input availability', () => {
        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton />
            </TooltipProvider>
        );

        expect(screen.queryByRole('button', { name: /Voice command/ })).not.toBeInTheDocument();
    });

    it('should render active state from voiceStatusStore', () => {
        voiceButtonMocks.isVoiceInputAvailable.mockReturnValue(true);
        voiceButtonMocks.voiceStatus.current = { isListening: true, transcribing: false };

        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton />
            </TooltipProvider>
        );

        expect(screen.getByRole('button', { name: 'Stop voice command' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('should emit voice.toggle when clicked', () => {
        voiceButtonMocks.isVoiceInputAvailable.mockReturnValue(true);

        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton />
            </TooltipProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: /Voice command/ }));

        expect(voiceButtonMocks.toggleVoiceInput).toHaveBeenCalledTimes(1);
    });
});
