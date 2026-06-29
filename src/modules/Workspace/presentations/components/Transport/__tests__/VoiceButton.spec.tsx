import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toggleVoiceInput } from '#/modules/AiRuntime/useCases';

import { VoiceButton } from '../VoiceButton';

const { emitMock } = vi.hoisted(() => ({ emitMock: vi.fn() }));

vi.mock('#/infra/store/useStore', () => ({
    useStore: () => ({ isListening: false, transcribing: false }),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: () => true,
}));

vi.mock('#/modules/AiRuntime/presentations/views/VoiceCommandOverlay', () => ({
    isSpeechRecognitionAvailable: () => false,
}));

const mockEventBus = {
    emit: emitMock,
    on: vi.fn(() => () => {}),
};

describe('VoiceButton', () => {
    beforeEach(() => {
        injectDependencies(toggleVoiceInput, { eventBus: mockEventBus });
        vi.clearAllMocks();
    });

    it('should emit voice.toggle when clicked', () => {
        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton />
            </TooltipProvider>
        );
        fireEvent.click(screen.getByRole('button', { name: /Voice command/ }));
        expect(emitMock).toHaveBeenCalledWith('voice.toggle', { active: undefined });
    });
});
