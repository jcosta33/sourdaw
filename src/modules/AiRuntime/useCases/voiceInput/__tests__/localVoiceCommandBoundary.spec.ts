import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { voiceInputAvailabilityStore } from '../../../stores/voiceInputAvailabilityStore';
import { resolveVoiceInputMode } from '../resolveVoiceInputMode';
import { voiceCommandGesture } from '../voiceCommandGesture';

describe('local voice command boundary', () => {
    afterEach(() => {
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });
        Reflect.deleteProperty(window, 'sourdaw');
        Reflect.deleteProperty(globalThis, 'SpeechRecognition');
        Reflect.deleteProperty(globalThis, 'webkitSpeechRecognition');
    });

    it('reports standalone browser unavailable because no browser speech mode exists', () => {
        Reflect.set(globalThis, 'SpeechRecognition', class BrowserRecognizer {});
        Reflect.set(globalThis, 'webkitSpeechRecognition', class BrowserRecognizer {});

        expect(resolveVoiceInputMode()).toBeNull();
    });

    it('does not treat desktop alone as microphone admission', () => {
        Reflect.set(window, 'sourdaw', {});
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });

        expect(resolveVoiceInputMode()).toBeNull();
    });

    it('admits only a verified desktop-local artifact', () => {
        Reflect.set(window, 'sourdaw', {});
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: true });

        expect(resolveVoiceInputMode()).toBe('whisper');
    });

    it('keeps speech loading cache-only and erases raw and derived audio at the native owner', () => {
        const speech =
            readFileSync(resolve(process.cwd(), 'crates/sourdaw-native/src/commands/speech.rs'), 'utf8').split(
                '\n#[cfg(test)]\nmod tests'
            )[0] ?? '';

        expect(speech).toContain('model_download::read_verified_cached_model');
        expect(speech).not.toContain('model_download::ensure_model');
        expect(speech).not.toContain('reqwest::');
        expect(speech).toContain('struct SensitiveCaptureBuffer');
        expect(speech).toContain('struct SensitiveF64Buffers');
        expect(speech).toContain('struct SensitiveResamplerOutput');
    });

    it('rejects a forged or programmatic start token', () => {
        expect(voiceCommandGesture.consume({})).toBe(false);
    });
});
