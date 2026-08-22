import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { VoiceCommandOverlay } from '../VoiceCommandOverlay';

// Mock external dependencies
vi.mock('../../hooks/useVoiceRecording', () => ({
    useVoiceRecording: vi.fn(() => ({
        isListening: false,
        transcribing: false,
        errorText: null,
        finalText: '',
        interimText: '',
        voiceMode: 'browser',
        stopListening: vi.fn(),
    })),
}));

const { useVoiceRecording } = await import('../../hooks/useVoiceRecording');

describe('VoiceCommandOverlay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: false,
            transcribing: false,
            errorText: null,
            finalText: '',
            interimText: '',
            voiceMode: 'whisper',
            stopListening: vi.fn(),
        });
    });

    it('should return null when not listening and no error', () => {
        const { container } = render(<VoiceCommandOverlay />);
        expect(container.firstChild).toBeNull();
    });

    it('should render when listening', () => {
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: true,
            transcribing: false,
            errorText: null,
            finalText: '',
            interimText: '',
            voiceMode: 'whisper',
            stopListening: vi.fn(),
        });

        const { container } = render(<VoiceCommandOverlay />);
        expect(container.firstChild).not.toBeNull();
    });

    it('should render when transcribing', () => {
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: false,
            transcribing: true,
            errorText: null,
            finalText: '',
            interimText: '',
            voiceMode: 'whisper',
            stopListening: vi.fn(),
        });

        render(<VoiceCommandOverlay />);
        expect(screen.getByText('Transcribing...')).toBeInTheDocument();
    });

    it('should render error state', () => {
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: false,
            transcribing: false,
            errorText: 'Microphone access denied',
            finalText: '',
            interimText: '',
            voiceMode: 'whisper',
            stopListening: vi.fn(),
        });

        render(<VoiceCommandOverlay />);
        expect(screen.getByText('Microphone access denied')).toBeInTheDocument();
    });

    it('should display listening text', () => {
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: true,
            transcribing: false,
            errorText: null,
            finalText: '',
            interimText: '',
            voiceMode: 'browser',
            stopListening: vi.fn(),
        });

        render(<VoiceCommandOverlay />);
        expect(screen.getByText('Listening...')).toBeInTheDocument();
    });

    it('should display recording text for whisper mode', () => {
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: true,
            transcribing: false,
            errorText: null,
            finalText: '',
            interimText: '',
            voiceMode: 'whisper',
            stopListening: vi.fn(),
        });

        render(<VoiceCommandOverlay />);
        expect(screen.getByText('Recording...')).toBeInTheDocument();
    });

    it('should call stopListening when mic button is clicked', () => {
        const mockStopListening = vi.fn();
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: true,
            transcribing: false,
            errorText: null,
            finalText: '',
            interimText: '',
            voiceMode: 'browser',
            stopListening: mockStopListening,
        });

        render(<VoiceCommandOverlay />);
        const stopButton = screen.getByLabelText('Stop voice input');
        fireEvent.click(stopButton);
        expect(mockStopListening).toHaveBeenCalled();
    });

    it('should display transcribed text', () => {
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: true,
            transcribing: false,
            errorText: null,
            finalText: 'Hello world',
            interimText: ' test',
            voiceMode: 'browser',
            stopListening: vi.fn(),
        });

        render(<VoiceCommandOverlay />);
        expect(screen.getByText('Hello world test')).toBeInTheDocument();
    });

    it('should show hint to tap mic when no error', () => {
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: true,
            transcribing: false,
            errorText: null,
            finalText: '',
            interimText: '',
            voiceMode: 'browser',
            stopListening: vi.fn(),
        });

        render(<VoiceCommandOverlay />);
        expect(screen.getByText('tap mic to stop')).toBeInTheDocument();
    });

    it('should have correct accessibility attributes', () => {
        (useVoiceRecording as ReturnType<typeof vi.fn>).mockReturnValue({
            isListening: true,
            transcribing: false,
            errorText: null,
            finalText: '',
            interimText: '',
            voiceMode: 'browser',
            stopListening: vi.fn(),
        });

        render(<VoiceCommandOverlay />);
        const stopButton = screen.getByLabelText('Stop voice input');
        expect(stopButton).toHaveAttribute('type', 'button');
    });
});
