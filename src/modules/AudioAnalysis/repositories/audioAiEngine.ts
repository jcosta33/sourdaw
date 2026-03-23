/**
 * Repository: AI Audio Engine client.
 * Communicates with the ai_audio_server.py Python sidecar for:
 *   - Text-to-music generation (MusicGen)
 *   - Stem separation (Demucs)
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

const logger = Container.getInstance().get(Logger);

const AI_AUDIO_PORT = 8848;
const BASE_URL = `http://127.0.0.1:${String(AI_AUDIO_PORT)}`;

/**
 * Check if the AI audio server is running.
 */
export async function isAudioAiServerRunning(): Promise<boolean> {
    try {
        const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Generate audio from a text prompt using MusicGen.
 * Returns an AudioBuffer decoded from the WAV response.
 */
export async function generateAudio(prompt: string, durationSeconds: number = 8): Promise<AudioBuffer> {
    logger.info(`[Audio AI] Generating audio: "${prompt}" (${String(durationSeconds)}s)`);

    const response = await fetch(`${BASE_URL}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            prompt,
            duration_s: Math.min(durationSeconds, 30),
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Audio generation failed: ${error}`);
    }

    const wavBytes = await response.arrayBuffer();
    logger.info(`[Audio AI] Generated ${String(wavBytes.byteLength)} bytes of audio`);

    // Decode WAV to AudioBuffer
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(wavBytes);
    await audioContext.close();

    return audioBuffer;
}

type StemResult = {
    [stemName: string]: AudioBuffer;
};

/**
 * Separate audio into stems using Demucs.
 * Accepts raw WAV data, returns decoded AudioBuffers for each stem.
 */
export async function separateStems(audioData: ArrayBuffer, stems: string[] = ['all']): Promise<StemResult> {
    logger.info(`[Audio AI] Separating stems: ${stems.join(', ')}`);

    // Encode audio as base64 for JSON transport
    const base64Audio = arrayBufferToBase64(audioData);

    const response = await fetch(`${BASE_URL}/separate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            audio: base64Audio,
            stems,
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Stem separation failed: ${error}`);
    }

    const data = (await response.json()) as Record<string, string>;

    // Decode each stem from base64 WAV
    const audioContext = new AudioContext();
    const result: StemResult = {};

    for (const [name, base64Wav] of Object.entries(data)) {
        const wavBytes = base64ToArrayBuffer(base64Wav);
        result[name] = await audioContext.decodeAudioData(wavBytes);
    }

    await audioContext.close();
    logger.info(`[Audio AI] Separated into ${String(Object.keys(result).length)} stems`);

    return result;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i] ?? 0);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
