import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

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

vi.mock('#/app/registerDependencies', () => ({
    eventBus: {
        emit: emitMock,
        on: vi.fn(() => () => {}),
    },
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    },
}));

describe('VoiceButton', () => {
    it('should emit voice.toggle when clicked', () => {
        emitMock.mockClear();
        render(
            <TooltipProvider delayDuration={0}>
                <VoiceButton />
            </TooltipProvider>
        );
        fireEvent.click(screen.getByRole('button', { name: /Voice command/ }));
        expect(emitMock).toHaveBeenCalledWith('voice.toggle', { active: undefined });
    });
});
