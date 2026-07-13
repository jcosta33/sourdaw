import { afterEach, describe, it, expect, vi } from 'vitest';

import { audioBufferCache } from '../audioBufferCache';

function createAudioBuffer({ length, sampleRate }: { length: number; sampleRate: number }): AudioBuffer {
    const channels = Array.from({ length: 1 }, () => new Float32Array(length));
    return {
        copyFromChannel: (destination, channelNumber, startInChannel = 0) => {
            destination.set(channels[channelNumber]!.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, channelNumber, startInChannel = 0) => {
            channels[channelNumber]!.set(source, startInChannel);
        },
        duration: length / sampleRate,
        getChannelData: (channelNumber) => channels[channelNumber]!,
        length,
        numberOfChannels: 1,
        sampleRate,
    };
}

function encodeFloat32(values: number[]): string {
    const bytes = new Uint8Array(new Float32Array(values).buffer);
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

// Test the pure conversion functions by importing them indirectly
// since they're not exported. We test them through the module's
// public API where possible, or test the pattern directly.

describe('audioBufferCache conversions', () => {
    afterEach(() => {
        audioBufferCache.clear();
    });

    it('Float32Array to base64 round-trip preserves data', async () => {
        const original = new Float32Array([0.5, -0.5, 0.25, -0.25, 0.0]);
        const bytes = new Uint8Array(original.buffer, original.byteOffset, original.byteLength);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const b64 = btoa(binary);

        // Decode back
        const decoded_binary = atob(b64);
        const decoded_bytes = new Uint8Array(decoded_binary.length);
        for (let i = 0; i < decoded_binary.length; i++) {
            decoded_bytes[i] = decoded_binary.charCodeAt(i);
        }
        const decoded = new Float32Array(decoded_bytes.buffer);

        expect(Array.from(decoded)).toEqual(Array.from(original));
    });

    it('round-trip with large Float32Array', async () => {
        const original = new Float32Array(10000);
        for (let i = 0; i < original.length; i++) {
            original[i] = Math.sin(i * 0.01);
        }

        const bytes = new Uint8Array(original.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const b64 = btoa(binary);

        const decoded_binary = atob(b64);
        const decoded_bytes = new Uint8Array(decoded_binary.length);
        for (let i = 0; i < decoded_binary.length; i++) {
            decoded_bytes[i] = decoded_binary.charCodeAt(i);
        }
        const decoded = new Float32Array(decoded_bytes.buffer);

        expect(decoded.length).toBe(original.length);
        expect(decoded[5000]).toBeCloseTo(original[5000]!, 5);
    });

    it('empty Float32Array round-trips correctly', () => {
        const original = new Float32Array(0);
        const bytes = new Uint8Array(original.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const b64 = btoa(binary);

        const decoded_binary = atob(b64);
        const decoded_bytes = new Uint8Array(decoded_binary.length);
        for (let i = 0; i < decoded_binary.length; i++) {
            decoded_bytes[i] = decoded_binary.charCodeAt(i);
        }
        const decoded = new Float32Array(decoded_bytes.buffer);

        expect(decoded.length).toBe(0);
    });

    it('single-element Float32Array round-trips', () => {
        const original = new Float32Array([1.0]);
        const bytes = new Uint8Array(original.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]!);
        }
        const b64 = btoa(binary);

        const decoded_binary = atob(b64);
        const decoded_bytes = new Uint8Array(decoded_binary.length);
        for (let i = 0; i < decoded_binary.length; i++) {
            decoded_bytes[i] = decoded_binary.charCodeAt(i);
        }
        const decoded = new Float32Array(decoded_bytes.buffer);

        expect(decoded[0]).toBeCloseTo(1.0, 5);
    });

    it('stages cancellation and treats newer embedded PCM as authoritative', async () => {
        const context = {
            createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => {
                expect(numberOfChannels).toBe(1);
                return createAudioBuffer({ length, sampleRate });
            }),
        };
        const first = { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.25])] };
        const second = { sampleRate: 48_000, numberOfChannels: 1, channelData: [encodeFloat32([0.75])] };

        await audioBufferCache.importBuffers({ context, buffers: { shared: first } });
        await audioBufferCache.importBuffers({ context, buffers: { shared: second }, shouldContinue: () => false });
        expect(audioBufferCache.get('shared')?.getChannelData(0)[0]).toBeCloseTo(0.25);

        await audioBufferCache.importBuffers({ context, buffers: { shared: second } });
        expect(audioBufferCache.get('shared')?.getChannelData(0)[0]).toBeCloseTo(0.75);
    });
});
