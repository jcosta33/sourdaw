import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

import opus from '../../src/modules/AudioRendering/repositories/audioEncoders/vendor/opus/opus-encode.js';
import ogg from '../../src/modules/AudioRendering/repositories/audioEncoders/vendor/vorbis/ogg-encode.js';

import { launch_new_project, setupWorkspace } from './e2eUtils';
import { installFilePickerCapture } from './exportFilePickerCapture';

// Retained pre-context files: compare codec packets without their random Ogg serial/CRC.
const oneFrameOpusPackets = {
    mono: [
        '21701d1a08824aed1bb94053e240c792bd0c3634bcdf21e5b9b405732fd6df8b',
        'dccb8269be8fee3f96be39e6ab41ed043fb6cee29f284de339076e3e2d3a5501',
        '5b0b5968fc2e3976a2ff18ad9f7d9d2ef300b72eac281ff7e179ba2bf7c84880',
    ],
    stereo: [
        'e1ca6670203e4713d51d3768e199ca5bf1f8e3740a28a2d378feafdf8b6429c6',
        'dccb8269be8fee3f96be39e6ab41ed043fb6cee29f284de339076e3e2d3a5501',
        '72d987a48214345032519033bbdcb4e08a295fa13af4c627320a39efdbf0627f',
    ],
};

function oggPacketDigests(bytes: Uint8Array) {
    const digests: string[] = [];
    let offset = 0,
        parts: Uint8Array[] = [];
    while (offset < bytes.length) {
        expect(Buffer.from(bytes.subarray(offset, offset + 4)).toString()).toBe('OggS');
        const segmentEnd = offset + 27 + bytes[offset + 26]!;
        let position = segmentEnd;
        for (const length of bytes.subarray(offset + 27, segmentEnd)) {
            parts.push(bytes.subarray(position, position + length));
            position += length;
            if (length < 255) {
                digests.push(createHash('sha256').update(Buffer.concat(parts)).digest('hex'));
                parts = [];
            }
        }
        offset = position;
    }
    expect(offset).toBe(bytes.length);
    expect(parts).toHaveLength(0);
    return digests;
}

function sourceWav(rate: number, channels: number, frames: number) {
    const bytes = Buffer.alloc(44 + frames * channels * 2);
    bytes.write('RIFF');
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(channels, 22);
    bytes.writeUInt32LE(rate, 24);
    bytes.writeUInt32LE(rate * channels * 2, 28);
    bytes.writeUInt16LE(channels * 2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(bytes.length - 44, 40);
    for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            bytes.writeInt16LE(
                Math.round(
                    9000 * Math.sin((2 * Math.PI * (channel ? 733 : 431) * frame) / rate + 0.2 + channel * 0.37)
                ),
                44 + (frame * channels + channel) * 2
            );
        }
    }
    return bytes;
}

async function audibleProject(page: Page, rate: number, channels: number, frames: number) {
    await setupWorkspace(page);
    await launch_new_project(page);
    const addTrack = page.locator('button').filter({ hasText: 'MIDI' }).filter({ hasText: 'Keys' });
    await expect(addTrack).toBeVisible();
    await addTrack.click();
    const row = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .first();
    await expect(row).toBeVisible();
    await row.click({ button: 'right' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (
        await chooser
    ).setFiles({ name: 'codec-phase-tail.wav', mimeType: 'audio/wav', buffer: sourceWav(rate, channels, frames) });
    await row.click();
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    await page.getByRole('tab', { name: 'Editor', exact: true }).click();
    await expect(page.getByTestId('selected-track-clip-count')).toHaveText(/1 clip/i);
    const modifier = await page.evaluate(() => (navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'));
    await page.keyboard.press(`${modifier}+Shift+E`);
    const dialog = page.getByRole('dialog').filter({ hasText: /The Bakery/i });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Auto-detect').uncheck();
    await dialog.getByLabel('Tail seconds').fill('0');
    await dialog.getByRole('button', { name: `${(rate / 1000).toFixed(1)}k`, exact: true }).click();
    return dialog;
}

function opusDuration(bytes: Uint8Array) {
    let offset = 0,
        preSkip = 0,
        granule = 0n,
        eos = false;
    while (offset < bytes.length) {
        expect(Buffer.from(bytes.subarray(offset, offset + 4)).toString()).toBe('OggS');
        const segments = bytes[offset + 26]!,
            body = offset + 27 + segments;
        if (offset === 0) {
            expect(Buffer.from(bytes.subarray(body, body + 8)).toString()).toBe('OpusHead');
            preSkip = new DataView(bytes.buffer, bytes.byteOffset + body).getUint16(10, true);
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
        granule = view.getBigUint64(6, true);
        eos = (bytes[offset + 5]! & 4) !== 0;
        offset = body + bytes.subarray(offset + 27, body).reduce((sum, n) => sum + n, 0);
    }
    expect(offset).toBe(bytes.length);
    expect(eos).toBe(true);
    expect(preSkip).toBeGreaterThan(0);
    return Number(granule - BigInt(preSkip));
}

async function decode(page: Page, bytes: Uint8Array) {
    return page.evaluate(async (values) => {
        const context = new AudioContext({ sampleRate: 48000 });
        try {
            const decoded = await context.decodeAudioData(Uint8Array.from(values).buffer);
            return {
                rate: decoded.sampleRate,
                frames: decoded.length,
                channels: Array.from({ length: decoded.numberOfChannels }, (_, channel) =>
                    Array.from(decoded.getChannelData(channel))
                ),
            };
        } finally {
            await context.close();
        }
    }, Array.from(bytes));
}

for (const rate of [44100, 48000, 88200, 96000]) {
    // The existing browser render UI produces stereo; mono belongs to encoder-boundary proof.
    for (const channels of [2]) {
        test(`UI saves both codecs with real ${rate}Hz/${channels}ch WAV reference, phase and non-aligned tail`, async ({
            page,
        }, info) => {
            test.setTimeout(180000);
            const failures: string[] = [];
            page.on('pageerror', (error) => failures.push(error.message));
            const capture = await installFilePickerCapture(page, info.outputPath('actual-codecs.zip'));
            try {
                // Whole project has a16-beat minimum. Put non-silent programme beyond
                // that boundary so the measured final segment is the imported tail.
                const frames = rate * 8.5;
                const dialog = await audibleProject(page, rate, channels, frames);
                await dialog.getByTestId('export-format-ogg').click();
                await dialog.getByTestId('export-format-opus').click();
                await expect(dialog.getByTestId('export-format-wav')).toHaveAttribute('aria-checked', 'true');
                await expect(dialog.getByText(/Opus is always 48 kHz/)).toBeVisible();
                await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
                await expect(dialog.getByRole('button', { name: 'Close Bakery', exact: true })).toBeVisible({
                    timeout: 120000,
                });
                await capture.waitForClose();
                expect(await capture.pickerFilename).toMatch(/\.zip$/);
                const entries = unzipSync(await readFile(capture.path)),
                    names = Object.keys(entries);
                expect(names).toHaveLength(3);
                const wavName = names.find((name) => name.endsWith('.wav'))!;
                expect(wavName).toBeTruthy();
                const reference = await decode(page, entries[wavName]!);
                expect(reference.channels).toHaveLength(channels);
                expect(Math.abs(reference.frames - Math.round((frames * 48000) / rate))).toBeLessThanOrEqual(1);
                const measurements = [];
                for (const codec of ['ogg', 'opus']) {
                    const name = names.find((name) => name.endsWith('.' + codec));
                    expect(name).toBeTruthy();
                    const bytes = entries[name!]!,
                        actual = await decode(page, bytes);
                    expect(actual.rate).toBe(48000);
                    expect(actual.channels).toHaveLength(channels);
                    expect(Math.abs(actual.frames - reference.frames)).toBeLessThanOrEqual(1);
                    if (codec === 'opus') {
                        expect(Math.abs(actual.frames - opusDuration(bytes))).toBeLessThanOrEqual(1);
                    } else {
                        // decodeAudioData resamples to its context; inspect the real identification header.
                        const body = 27 + bytes[26]!;
                        expect(Buffer.from(bytes.subarray(body + 1, body + 7)).toString()).toBe('vorbis');
                        expect(bytes[body]).toBe(1);
                        expect(bytes[body + 11]).toBe(channels);
                        expect(new DataView(bytes.buffer, bytes.byteOffset + body).getUint32(12, true)).toBe(rate);
                    }
                    for (let channel = 0; channel < channels; channel++) {
                        for (const [start, end] of [
                            [256, Math.min(actual.frames, reference.frames) - 128],
                            [
                                Math.min(actual.frames, reference.frames) - 2048,
                                Math.min(actual.frames, reference.frames) - 64,
                            ],
                        ]) {
                            let a = 0,
                                b = 0,
                                correlation = 0;
                            for (let frame = start!; frame < end!; frame++) {
                                const x = actual.channels[channel]![frame]!,
                                    y = reference.channels[channel]![frame]!;
                                a += x * x;
                                b += y * y;
                                correlation += x * y;
                            }
                            expect(b).toBeGreaterThan(0);
                            expect(Math.abs(10 * Math.log10(a / b))).toBeLessThanOrEqual(0.5);
                            expect(correlation / Math.sqrt(a * b)).toBeGreaterThan(0.95);
                        }
                    }
                    measurements.push({
                        codec,
                        bytes: bytes.length,
                        frames: actual.frames,
                        configured: codec === 'ogg' ? 'Vorbis quality4 VBR' : 'Opus128kbps VBR/audio',
                        actualKbps: (bytes.length * 8 * 48000) / actual.frames / 1000,
                    });
                }
                expect(capture.abortCount()).toBe(0);
                expect(capture.writeCount()).toBeGreaterThan(1);
                expect(failures).toEqual([]);
                await info.attach('codec-complete-file-quality', {
                    body: JSON.stringify({ rate, channels, measurements }),
                    contentType: 'application/json',
                });
            } finally {
                await page.close();
                await capture.dispose();
            }
        });
    }
}

for (const codec of ['ogg', 'opus']) {
    test(`UI saves ${codec} alone with audio/ogg picker and real complete-file decode`, async ({ page }, info) => {
        test.setTimeout(180000);
        const capture = await installFilePickerCapture(page, info.outputPath('actual.' + codec));
        try {
            const dialog = await audibleProject(page, 48000, 2, 48137);
            await page.evaluate(() => {
                const original = Reflect.get(window, 'showSaveFilePicker');
                if (typeof original !== 'function') {
                    throw new Error('Missing captured file picker');
                }
                Object.defineProperty(window, 'showSaveFilePicker', {
                    configurable: true,
                    value: async (options: unknown) => {
                        Reflect.set(window, '__codecPickerOptions', options);
                        return original(options);
                    },
                });
            });
            await dialog.getByTestId('export-format-' + codec).click();
            await dialog.getByTestId('export-format-wav').click();
            await expect(dialog.getByTestId('export-format-wav')).toHaveAttribute('aria-checked', 'false');
            await expect(dialog.getByTestId('export-format-' + codec)).toHaveAttribute('aria-checked', 'true');
            await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
            await expect(dialog.getByRole('button', { name: 'Close Bakery', exact: true })).toBeVisible({
                timeout: 120000,
            });
            await capture.waitForClose();
            expect(await capture.pickerFilename).toMatch(new RegExp('\\.' + codec + '$'));
            expect(await page.evaluate(() => Reflect.get(window, '__codecPickerOptions'))).toMatchObject({
                types: [{ accept: { 'audio/ogg': ['.' + codec] } }],
            });
            const result = await decode(page, await readFile(capture.path));
            expect(result.channels).toHaveLength(2);
            expect(result.frames).toBeGreaterThan(48000);
        } finally {
            await page.close();
            await capture.dispose();
        }
    });
}

test('Slices saves actual codec stems with the selected-rate WAV reference', async ({ page }, info) => {
    test.setTimeout(180000);
    const capture = await installFilePickerCapture(page, info.outputPath('actual-codec-stems.zip'));
    try {
        const dialog = await audibleProject(page, 44100, 2, 44100 * 8.5);
        await dialog.getByTestId('export-mode-stems').click();
        await dialog.getByTestId('export-format-ogg').click();
        await dialog.getByTestId('export-format-opus').click();
        await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Close Bakery', exact: true })).toBeVisible({
            timeout: 120000,
        });
        await capture.waitForClose();
        const entries = unzipSync(await readFile(capture.path));
        expect(Object.keys(entries)).toHaveLength(3);
        const wavName = Object.keys(entries).find((name) => name.endsWith('.wav'));
        expect(wavName).toBeTruthy();
        const wav = entries[wavName!]!;
        expect(new DataView(wav.buffer, wav.byteOffset).getUint32(24, true)).toBe(44100);
        const reference = await decode(page, wav);
        for (const codec of ['ogg', 'opus']) {
            const name = Object.keys(entries).find((entry) => entry.endsWith('.' + codec));
            expect(name).toBeTruthy();
            const actual = await decode(page, entries[name!]!);
            expect(actual.channels).toHaveLength(2);
            expect(Math.abs(actual.frames - reference.frames)).toBeLessThanOrEqual(1);
            for (let channel = 0; channel < 2; channel++) {
                let sourceEnergy = 0,
                    actualEnergy = 0;
                for (let frame = 256; frame < reference.frames - 128; frame++) {
                    sourceEnergy += reference.channels[channel]![frame]! ** 2;
                    actualEnergy += actual.channels[channel]![frame]! ** 2;
                }
                expect(sourceEnergy).toBeGreaterThan(0);
                expect(Math.abs(10 * Math.log10(actualEnergy / sourceEnergy))).toBeLessThanOrEqual(0.5);
            }
        }
        expect(capture.abortCount()).toBe(0);
        expect(capture.writeCount()).toBeGreaterThan(1);
    } finally {
        await page.close();
        await capture.dispose();
    }
});

test('the actual codec wrappers preserve short and nominal mono/stereo duration and declared level obligations', async ({
    page,
}, info) => {
    await page.goto('/');
    const measurements = [];
    for (const frames of [1, 137, 997, 48137]) {
        for (const channels of [1, 2]) {
            const pcm = Array.from({ length: channels }, (_, channel) =>
                Float32Array.from(
                    { length: frames },
                    (_, frame) =>
                        0.2 * Math.sin((2 * Math.PI * (channel ? 733 : 431) * frame) / 48000 + 0.2 + channel * 0.37)
                )
            );
            for (const codec of ['ogg', 'opus']) {
                const encoder =
                    codec === 'ogg'
                        ? await ogg({ sampleRate: 48000, channels, quality: 4 })
                        : await opus({
                              sampleRate: 48000,
                              channels,
                              bitrate: 128,
                              application: 'audio',
                              complexity: 10,
                          });
                let bytes: Uint8Array;
                try {
                    const chunks: Uint8Array[] = [];
                    for (let start = 0; start < frames; start += 4096) {
                        chunks.push(encoder.encode(pcm.map((channel) => channel.subarray(start, start + 4096))));
                    }
                    bytes = Buffer.concat([...chunks, encoder.flush()]);
                } finally {
                    encoder.free();
                }
                const result: {
                    frames: number;
                    channels: number;
                    codec: string;
                    bytes: number;
                    outputFrames?: number;
                    levelObligation: string;
                    differencesDb: number[];
                    failure?: string;
                } = {
                    frames,
                    channels,
                    codec,
                    bytes: bytes.length,
                    levelObligation:
                        codec === 'opus' && frames === 1
                            ? 'diagnostic level with frozen-packet nonregression'
                            : 'source-relative 0.5dB fixture',
                    differencesDb: [],
                };
                try {
                    const output = await decode(page, bytes);
                    result.outputFrames = output.frames;
                    expect(output.channels).toHaveLength(channels);
                    expect(output.frames).toBe(frames);
                    if (codec === 'opus') {
                        expect(opusDuration(bytes)).toBe(frames);
                        if (frames === 1) {
                            expect(oggPacketDigests(bytes)).toEqual(
                                channels === 1 ? oneFrameOpusPackets.mono : oneFrameOpusPackets.stereo
                            );
                        }
                    }
                    for (let channel = 0; channel < channels; channel++) {
                        let reference = 0,
                            actual = 0;
                        for (let frame = 0; frame < Math.min(frames, output.frames); frame++) {
                            reference += pcm[channel]![frame]! ** 2;
                            actual += output.channels[channel]![frame]! ** 2;
                        }
                        const differenceDb = 10 * Math.log10(actual / reference);
                        result.differencesDb.push(differenceDb);
                        expect(Number.isFinite(differenceDb)).toBe(true);
                        // One sample has diagnostic level; its original Opus packets must not regress.
                        // The sustained programme/UI matrix above retains the unchanged 0.5dB bound.
                        if (codec !== 'opus' || frames !== 1) {
                            expect(Math.abs(differenceDb)).toBeLessThanOrEqual(0.5);
                        }
                    }
                } catch (error) {
                    result.failure = String(error);
                }
                measurements.push(result);
                await info.attach(`short-${codec}-${frames}-${channels}`, {
                    body: JSON.stringify(result),
                    contentType: 'application/json',
                });
                await info.attach(`short-${codec}-${frames}-${channels}-actual-file`, {
                    body: Buffer.from(bytes),
                    contentType: 'audio/ogg',
                });
            }
        }
    }
    // Preserve every named failure while collecting the complete boundary matrix.
    expect(measurements.filter((measurement) => measurement.failure)).toEqual([]);
});

for (const codec of ['ogg', 'opus']) {
    test(`real ${codec} Worker drains bounded output, cancels transactionally and permits repeated immediate successors`, async ({
        page,
    }, info) => {
        test.setTimeout(180000);
        await page.addInitScript(() => {
            const proof = {
                workers: [] as {
                    requests: number;
                    pending: number;
                    maxPending: number;
                    maxPcmFrames: number;
                    maxOutputBytes: number;
                    awaitingAck: boolean;
                    terminations: number;
                }[],
                violations: [] as string[],
                held: false,
                aborts: 0,
                closes: 0,
                picks: 0,
            };
            Reflect.set(window, '__oggLifecycleProof', proof);
            const NativeWorker = window.Worker;
            window.Worker = class extends NativeWorker {
                private observation: (typeof proof.workers)[number] | undefined;
                constructor(url: string | URL, options?: WorkerOptions) {
                    super(url, options);
                    if (String(url).includes('/AudioRendering/workers/oggCodecWorker')) {
                        const observation = {
                            requests: 0,
                            pending: 0,
                            maxPending: 0,
                            maxPcmFrames: 0,
                            maxOutputBytes: 0,
                            awaitingAck: false,
                            terminations: 0,
                        };
                        this.observation = observation;
                        proof.workers.push(observation);
                        this.addEventListener(
                            'message',
                            (
                                event: MessageEvent<{ kind: 'chunk'; bytes: Uint8Array } | { kind: 'done' | 'error' }>
                            ) => {
                                const message = event.data;
                                if (message.kind === 'chunk') {
                                    if (observation.awaitingAck) {
                                        proof.violations.push('concurrent output before sink acknowledgement');
                                    }
                                    observation.awaitingAck = true;
                                    observation.maxOutputBytes = Math.max(
                                        observation.maxOutputBytes,
                                        message.bytes.byteLength
                                    );
                                } else if (message.kind === 'done' || message.kind === 'error') {
                                    if (observation.awaitingAck) {
                                        proof.violations.push('request completed before sink acknowledgement');
                                    }
                                    observation.pending -= 1;
                                }
                            }
                        );
                    }
                }
                override postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
                    const observation = this.observation;
                    if (observation && message && typeof message === 'object' && 'kind' in message) {
                        if (message.kind === 'ack') {
                            if (proof.held) {
                                proof.violations.push('acknowledged a held sink write');
                            }
                            observation.awaitingAck = false;
                        } else {
                            if (proof.held) {
                                proof.violations.push('advanced PCM or flush while the sink was held');
                            }
                            observation.requests += 1;
                            observation.pending += 1;
                            observation.maxPending = Math.max(observation.maxPending, observation.pending);
                            if (message.kind === 'encode' && 'channels' in message && Array.isArray(message.channels)) {
                                observation.maxPcmFrames = Math.max(
                                    observation.maxPcmFrames,
                                    message.channels[0]?.length ?? 0
                                );
                            }
                        }
                    }
                    if (Array.isArray(options)) {
                        super.postMessage(message, options);
                    } else {
                        super.postMessage(message, options);
                    }
                }
                override terminate() {
                    if (this.observation) {
                        this.observation.terminations += 1;
                    }
                    super.terminate();
                }
            };
            Object.defineProperty(window, 'showSaveFilePicker', {
                configurable: true,
                value: async () => {
                    const root = await navigator.storage.getDirectory();
                    const handle = await root.getFileHandle('codec-cancel-successor-proof', { create: true });
                    const first = ++proof.picks === 1;
                    if (first) {
                        const seed = await handle.createWritable();
                        await seed.write('previous completed export');
                        await seed.close();
                    }
                    return {
                        createWritable: async () => {
                            const writable = await handle.createWritable();
                            let release: (() => void) | undefined;
                            let aborted = false;
                            let hold = first;
                            return {
                                write: async (bytes: Uint8Array<ArrayBuffer>) => {
                                    if (hold) {
                                        hold = false;
                                        proof.held = true;
                                        await new Promise<void>((resolve) => {
                                            release = resolve;
                                        });
                                        proof.held = false;
                                        if (aborted) {
                                            throw new Error('Test-owned transaction was cancelled');
                                        }
                                    }
                                    await writable.write(bytes);
                                },
                                close: async () => {
                                    await writable.close();
                                    proof.closes += 1;
                                },
                                abort: async () => {
                                    aborted = true;
                                    await writable.abort();
                                    proof.aborts += 1;
                                    release?.();
                                },
                            };
                        },
                    };
                },
            });
        });
        const dialog = await audibleProject(page, 48000, 2, 48000 * 8.5);
        await dialog.getByTestId('export-format-' + codec).click();
        await dialog.getByTestId('export-format-wav').click();
        await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
        await expect.poll(() => page.evaluate(() => Reflect.get(window, '__oggLifecycleProof').held)).toBe(true);
        const held = await page.evaluate(() => Reflect.get(window, '__oggLifecycleProof'));
        expect(held.workers).toHaveLength(1);
        expect(held.workers[0]).toMatchObject({ pending: 1, maxPending: 1, awaitingAck: true, terminations: 0 });
        await dialog.getByRole('button', { name: 'Turn off Oven', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'Start Baking', exact: true })).toBeEnabled();
        const previous = await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            return (await (await root.getFileHandle('codec-cancel-successor-proof')).getFile()).text();
        });
        expect(previous).toBe('previous completed export');
        for (let repeat = 0; repeat < 2; repeat++) {
            await dialog.getByRole('button', { name: 'Start Baking', exact: true }).click();
            await expect(dialog.getByRole('button', { name: 'Close Bakery', exact: true })).toBeVisible({
                timeout: 120000,
            });
            await dialog.getByRole('button', { name: 'Close Bakery', exact: true }).click();
            if (repeat === 0) {
                const modifier = await page.evaluate(() =>
                    navigator.platform.toUpperCase().includes('MAC') ? 'Meta' : 'Control'
                );
                await page.keyboard.press(`${modifier}+Shift+E`);
                await expect(dialog).toBeVisible();
            }
            const bytes = await page.evaluate(async () => {
                const root = await navigator.storage.getDirectory();
                const file = await (await root.getFileHandle('codec-cancel-successor-proof')).getFile();
                return Array.from(new Uint8Array(await file.arrayBuffer()));
            });
            const decoded = await decode(page, Uint8Array.from(bytes));
            expect(decoded.channels).toHaveLength(2);
            expect(decoded.frames).toBe(48000 * 8.5);
        }
        const result = await page.evaluate(() => Reflect.get(window, '__oggLifecycleProof'));
        expect(result.violations).toEqual([]);
        expect(result.aborts).toBe(1);
        expect(result.closes).toBe(2);
        expect(result.workers).toHaveLength(3);
        for (const worker of result.workers) {
            expect(worker.terminations).toBe(1);
            expect(worker.maxPending).toBe(1);
            expect(worker.maxPcmFrames).toBeGreaterThan(0);
            expect(worker.maxPcmFrames).toBeLessThanOrEqual(4096);
            expect(worker.maxOutputBytes).toBeGreaterThan(0);
            expect(worker.maxOutputBytes).toBeLessThanOrEqual(1024 * 1024);
        }
        await info.attach('actual-worker-and-transaction-lifecycle', {
            body: JSON.stringify(result),
            contentType: 'application/json',
        });
        await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            await root.removeEntry('codec-cancel-successor-proof');
        });
    });
}
