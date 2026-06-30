import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { isBrowserSpeechRecognitionAvailable } from '../isBrowserSpeechRecognitionAvailable';

describe('isBrowserSpeechRecognitionAvailable', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis, 'SpeechRecognition', { value: undefined, configurable: true });
        Object.defineProperty(globalThis, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    });

    afterEach(() => {
        Object.defineProperty(globalThis, 'SpeechRecognition', { value: undefined, configurable: true });
        Object.defineProperty(globalThis, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    });

    it('should return true when standard SpeechRecognition exists', () => {
        const speechRecognitionConstructor = vi.fn();
        Object.defineProperty(globalThis, 'SpeechRecognition', {
            value: speechRecognitionConstructor,
            configurable: true,
        });

        expect(isBrowserSpeechRecognitionAvailable()).toBe(true);
    });

    it('should return true when webkitSpeechRecognition exists', () => {
        const webkitSpeechRecognition = vi.fn();
        Object.defineProperty(globalThis, 'webkitSpeechRecognition', {
            value: webkitSpeechRecognition,
            configurable: true,
        });

        expect(isBrowserSpeechRecognitionAvailable()).toBe(true);
    });

    it('should return false when no browser speech recognition constructor exists', () => {
        expect(isBrowserSpeechRecognitionAvailable()).toBe(false);
    });
});
