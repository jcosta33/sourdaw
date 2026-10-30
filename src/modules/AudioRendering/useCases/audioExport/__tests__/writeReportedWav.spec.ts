import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { measureIntegratedLoudness } from '#/utils/audioMetering/measureIntegratedLoudness';
import { measureTruePeak } from '#/utils/audioMetering/measureTruePeak';

import { type WavLoudnessReport } from '../../../models/ExportLoudnessReport';
import { audioBufferToWav } from '../../../repositories/audioEncoders/wavEncoder';
import { writeReportedWav } from '../writeReportedWav';

function source(length = 22050) {
    const samples = Float32Array.from({ length }, (_, frame) => 0.25 * Math.sin((2 * Math.PI * 1000 * frame) / 44100));
    return { length, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => samples };
}

function collect(chunks: Uint8Array[]) {
    const bytes = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }
    return bytes;
}

function createEntry() {
    const chunks: Uint8Array[] = [];
    return {
        chunks,
        writer: {
            write: vi.fn(async (bytes: Uint8Array) => {
                chunks.push(bytes.slice());
            }),
        },
        finish: vi.fn(async () => {}),
    };
}

function destination() {
    const entries = new Map<string, ReturnType<typeof createEntry>>();
    const beginFile = vi.fn(async (name: string) => {
        const entry = createEntry();
        entries.set(name, entry);
        return entry;
    });
    return { entries, beginFile, registerReportPair: vi.fn() };
}

function options(output = destination()) {
    return {
        source: source(),
        bitDepth: 16 as const,
        dither: { mode: 'tpdf' as const },
        stemId: 'stem-id-independent-of-name',
        targetId: 'target-id-independent-of-name',
        audioName: 'renamed-take.wav',
        progress: vi.fn(),
        destination: output,
        checkCancelled: vi.fn(),
    };
}

function report(output: ReturnType<typeof destination>): WavLoudnessReport {
    const entry = output.entries.get('renamed-take.wav.loudness.json');
    if (!entry) throw new Error('Expected a staged report.');
    return JSON.parse(new TextDecoder().decode(collect(entry.chunks)));
}

function decode(bytes: Uint8Array, bitDepth: 16 | 24 | 32, frames: number) {
    const samples = new Float32Array(frames);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLength = bitDepth === 32 ? 46 : 44;
    for (let frame = 0; frame < frames; frame++) {
        const offset = headerLength + (frame * bitDepth) / 8;
        if (bitDepth === 16) {
            samples[frame] = view.getInt16(offset, true) / 32768;
        } else if (bitDepth === 24) {
            const raw = bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65536;
            samples[frame] = (raw >= 8388608 ? raw - 16777216 : raw) / 8388608;
        } else {
            samples[frame] = view.getFloat32(offset, true);
        }
    }
    return samples;
}

afterEach(() => vi.restoreAllMocks());

describe('reported WAV staging', () => {
    it.each([16, 24, 32] as const)('binds the report to real %i-bit output and decoded levels', async (bitDepth) => {
        const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.125).mockReturnValue(0.875);
        const input = { ...options(), bitDepth };
        const originalDither = { ...input.dither };
        const originalPcm = input.source.getChannelData().slice();
        await writeReportedWav(input);
        const audio = input.destination.entries.get(input.audioName)!;
        const bytes = collect(audio.chunks);
        const expectedBytes = new Uint8Array(
            await audioBufferToWav(input.source, bitDepth, undefined, { mode: 'tpdf', seed: 0x20000000 })
        );
        expect(bytes).toEqual(expectedBytes);
        expect(random).toHaveBeenCalledOnce();
        expect(input.dither).toEqual(originalDither);
        expect(input.source.getChannelData()).toEqual(originalPcm);
        const measured = report(input.destination);
        expect(measured).toMatchObject({
            algorithmRevision: 'sourdaw-current-kweight-4x12tap-v1',
            measurementBasis: 'decoded-WAV-bytes',
            publicationAttested: false,
            stemId: input.stemId,
            targetId: input.targetId,
            audioFile: input.audioName,
            wav: {
                encoding: bitDepth === 32 ? 'IEEE_FLOAT' : 'PCM',
                channels: 1,
                sampleRate: 44100,
                bitDepth,
                frames: input.source.length,
                bytes: bytes.length,
                md5: createHash('md5').update(bytes).digest('hex'),
            },
        });
        const decoded = decode(bytes, bitDepth, input.source.length);
        expect(measured.integrated).toEqual({
            value: measureIntegratedLoudness({ channels: [decoded], length: decoded.length, sampleRate: 44100 }),
            unit: 'LUFS',
        });
        expect(measured.truePeak).toEqual({
            value: 20 * Math.log10(measureTruePeak({ channels: [decoded], length: decoded.length })),
            unit: 'dBTP',
        });
        expect(measured.maxMomentary).toHaveProperty('value');
        expect(measured.maxShortTerm).toEqual({ unavailable: 'short-window', unit: 'LUFS' });
        expect(audio.finish).toHaveBeenCalledOnce();
        expect(input.destination.registerReportPair).toHaveBeenCalledExactlyOnceWith(
            input.audioName,
            `${input.audioName}.loudness.json`
        );
        expect(input.progress).toHaveBeenLastCalledWith(1);
    });

    it('replays a cropped block source without AudioBuffer access or mutation', async () => {
        const backing = source(12000).getChannelData();
        const before = backing.slice();
        const readChannels = vi.fn((start: number, length: number) => [
            backing.subarray(137 + start, 137 + start + length),
        ]);
        const cropped = {
            length: 9000,
            numberOfChannels: 1,
            sampleRate: 44100,
            gain: 0.5,
            samplePeak: 0.25,
            readChannels,
        };
        const forbidden = vi.fn(() => {
            throw new Error('Full AudioBuffer access is forbidden.');
        });
        Object.defineProperty(cropped, 'getChannelData', { value: forbidden });
        const input = { ...options(), source: cropped, dither: { mode: 'none' as const, seed: 19 } };
        await writeReportedWav(input);
        expect(forbidden).not.toHaveBeenCalled();
        expect(readChannels.mock.calls).toEqual([
            [0, 4096],
            [4096, 4096],
            [8192, 808],
            [0, 4096],
            [4096, 4096],
            [8192, 808],
        ]);
        const expected = new Uint8Array(
            await audioBufferToWav(
                { ...cropped, getChannelData: () => backing.subarray(137, 9137), readChannels: undefined },
                16,
                undefined,
                input.dither
            )
        );
        expect(collect(input.destination.entries.get(input.audioName)!.chunks)).toEqual(expected);
        expect(backing).toEqual(before);
        expect(report(input.destination).wav.frames).toBe(9000);
    });

    it('rejects a same-shape PCM change between passes before sealing or creating a report', async () => {
        const input = options();
        const begin = input.destination.beginFile.getMockImplementation()!;
        input.destination.beginFile.mockImplementation(async (name) => {
            input.source.getChannelData()[100] = 0.75;
            return begin(name);
        });
        await expect(writeReportedWav(input)).rejects.toThrow('emitted audio changed between measurement and output');
        expect(input.destination.beginFile).toHaveBeenCalledExactlyOnceWith(input.audioName);
        expect(input.destination.entries.get(input.audioName)!.finish).not.toHaveBeenCalled();
        expect(input.destination.registerReportPair).not.toHaveBeenCalled();
    });

    it('awaits WAV sealing before creating the report', async () => {
        const input = options();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const begin = input.destination.beginFile.getMockImplementation()!;
        input.destination.beginFile.mockImplementation(async (name) => {
            const entry = await begin(name);
            if (name === input.audioName)
                entry.finish.mockImplementation(() => {
                    entered.resolve();
                    return release.promise;
                });
            return entry;
        });
        const writing = writeReportedWav(input);
        await entered.promise;
        expect(input.destination.beginFile).toHaveBeenCalledExactlyOnceWith(input.audioName);
        expect(input.destination.registerReportPair).not.toHaveBeenCalled();
        release.resolve();
        await writing;
        expect(input.destination.beginFile).toHaveBeenCalledTimes(2);
    });

    it('propagates report write rejection without sealing or registering it', async () => {
        const input = options();
        const failure = new Error('report storage failed');
        const begin = input.destination.beginFile.getMockImplementation()!;
        input.destination.beginFile.mockImplementation(async (name) => {
            const entry = await begin(name);
            if (name.endsWith('.json')) entry.writer.write.mockRejectedValue(failure);
            return entry;
        });
        await expect(writeReportedWav(input)).rejects.toBe(failure);
        expect(input.destination.entries.get(`${input.audioName}.loudness.json`)!.finish).not.toHaveBeenCalled();
        expect(input.destination.registerReportPair).not.toHaveBeenCalled();
    });

    it('stops a cancelled measurement pass before opening a destination entry', async () => {
        const input = options();
        const controller = new AbortController();
        const getChannelData = input.source.getChannelData;
        input.source.getChannelData = () => {
            controller.abort();
            return getChannelData();
        };
        await expect(writeReportedWav({ ...input, signal: controller.signal })).rejects.toThrow('Export cancelled');
        expect(input.destination.beginFile).not.toHaveBeenCalled();
        expect(input.destination.registerReportPair).not.toHaveBeenCalled();
    });

    it.each(['WAV', 'report'] as const)(
        'drains a pending %s write after cancellation before returning',
        async (stage) => {
            const input = options();
            const controller = new AbortController();
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const begin = input.destination.beginFile.getMockImplementation()!;
            input.destination.beginFile.mockImplementation(async (name) => {
                const entry = await begin(name);
                if ((stage === 'report') === name.endsWith('.json')) {
                    entry.writer.write.mockImplementationOnce(() => {
                        entered.resolve();
                        return release.promise;
                    });
                }
                return entry;
            });
            let settled = false;
            const writing = writeReportedWav({ ...input, signal: controller.signal }).finally(() => {
                settled = true;
            });
            const failure = expect(writing).rejects.toThrow('Export cancelled');
            await entered.promise;
            controller.abort();
            const outcome = await Promise.race([
                writing.then(
                    () => 'completed',
                    () => 'rejected'
                ),
                new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 0)),
            ]);
            expect(outcome).toBe('pending');
            expect(settled).toBe(false);
            expect(input.destination.registerReportPair).not.toHaveBeenCalled();
            release.resolve();
            await failure;
            const name = stage === 'WAV' ? input.audioName : `${input.audioName}.loudness.json`;
            expect(input.destination.entries.get(name)!.finish).not.toHaveBeenCalled();
            expect(input.destination.registerReportPair).not.toHaveBeenCalled();
            if (stage === 'WAV') expect(input.destination.beginFile).toHaveBeenCalledTimes(1);
        }
    );

    it('preserves an in-flight sink rejection when cancellation occurs before settlement', async () => {
        const input = options();
        const controller = new AbortController();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const storageFailure = new Error('original sink rejection');
        const begin = input.destination.beginFile.getMockImplementation()!;
        input.destination.beginFile.mockImplementation(async (name) => {
            const entry = await begin(name);
            entry.writer.write.mockImplementationOnce(() => {
                entered.resolve();
                return release.promise;
            });
            return entry;
        });
        const writing = writeReportedWav({ ...input, signal: controller.signal });
        const failure = expect(writing).rejects.toBe(storageFailure);
        await entered.promise;
        controller.abort();
        release.reject(storageFailure);
        await failure;
        expect(input.destination.registerReportPair).not.toHaveBeenCalled();
    });
});
