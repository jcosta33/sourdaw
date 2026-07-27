import { describe, expect, it } from 'vitest';

import {
    createPushDisplayProtocol,
    type PushDisplayScheduler,
    type PushDisplayTransport,
    type PushDisplayTransportWriteInput,
} from '../pushDisplayProtocol';

const DISPLAY_WIDTH = 960;
const DISPLAY_HEIGHT = 160;
const RGB_FRAME_BYTES = DISPLAY_WIDTH * DISPLAY_HEIGHT * 3;
const ROW_BYTES = 2_048;
const PIXEL_BYTES_PER_ROW = DISPLAY_WIDTH * 2;
const PAYLOAD_BYTES = DISPLAY_HEIGHT * ROW_BYTES;
const HEADER_BYTES = [0xff, 0xcc, 0xaa, 0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const XOR_MASK = [0xe7, 0xf3, 0xe7, 0xff];
const FRAME_INTERVAL_MS = 1_000 / 30;

type CapturedWrite = Readonly<{
    endpoint: number;
    data: Uint8Array;
    packetSize: number;
}>;

type Deferred<Value> = Readonly<{
    promise: Promise<Value>;
    resolve(value: Value): void;
}>;

function createDeferred<Value>(): Deferred<Value> {
    let resolvePromise: ((value: Value) => void) | undefined;
    const promise = new Promise<Value>((resolve) => {
        resolvePromise = resolve;
    });
    if (!resolvePromise) {
        throw new Error('Expected Promise executor to initialize synchronously');
    }

    return {
        promise,
        resolve: resolvePromise,
    };
}

function createRgbFrame(red = 0, green = 0, blue = 0): Uint8Array {
    const pixels = new Uint8Array(RGB_FRAME_BYTES);
    for (let index = 0; index < pixels.length; index += 3) {
        pixels[index] = red;
        pixels[index + 1] = green;
        pixels[index + 2] = blue;
    }
    return pixels;
}

function captureWrite(input: PushDisplayTransportWriteInput): CapturedWrite {
    return {
        endpoint: input.endpoint,
        data: input.data.slice(),
        packetSize: input.packetSize,
    };
}

function createSuccessfulTransport(): Readonly<{
    transport: PushDisplayTransport;
    writes: CapturedWrite[];
}> {
    const writes: CapturedWrite[] = [];
    const transport: PushDisplayTransport = {
        write(input) {
            writes.push(captureWrite(input));
            return Promise.resolve({ bytesWritten: input.data.length });
        },
    };

    return { transport, writes };
}

function createManualScheduler(): Readonly<{
    scheduler: PushDisplayScheduler;
    pendingCount(): number;
    nextDelay(): number | undefined;
    runNext(): void;
}> {
    let currentTime = 0;
    const scheduled: Array<{
        at: number;
        callback: () => void;
        cancelled: boolean;
    }> = [];

    return {
        scheduler: {
            now() {
                return currentTime;
            },
            schedule(delayMs, callback) {
                const entry = {
                    at: currentTime + delayMs,
                    callback,
                    cancelled: false,
                };
                scheduled.push(entry);
                return () => {
                    entry.cancelled = true;
                };
            },
        },
        pendingCount() {
            return scheduled.filter((entry) => !entry.cancelled).length;
        },
        nextDelay() {
            const next = scheduled.find((entry) => !entry.cancelled);
            if (!next) {
                return undefined;
            }
            return next.at - currentTime;
        },
        runNext() {
            const next = scheduled.find((entry) => !entry.cancelled);
            if (!next) {
                throw new Error('Expected a scheduled callback');
            }
            next.cancelled = true;
            currentTime = next.at;
            next.callback();
        },
    };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function requireWrite(writes: readonly CapturedWrite[], index: number): CapturedWrite {
    const write = writes.at(index);
    if (!write) {
        throw new Error(`Expected captured write ${index}`);
    }
    return write;
}

function requireByte(bytes: Uint8Array, index: number): number {
    const value = bytes.at(index);
    if (value === undefined) {
        throw new Error(`Expected byte ${index}`);
    }
    return value;
}

function removeXor(payload: Uint8Array, offset: number): number {
    const mask = XOR_MASK.at(offset % XOR_MASK.length);
    if (mask === undefined) {
        throw new Error(`Expected XOR mask for byte ${offset}`);
    }
    return requireByte(payload, offset) ^ mask;
}

describe('createPushDisplayProtocol', () => {
    it('encodes the exact header, BGR565 rows, filler, XOR mask, endpoint, and packet boundaries', async () => {
        const { transport, writes } = createSuccessfulTransport();
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });
        const pixels = createRgbFrame();
        pixels.set([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255], 0);

        await expect(protocol.submitFrame(pixels)).resolves.toEqual({ status: 'written' });

        expect(writes).toHaveLength(2);
        const headerWrite = requireWrite(writes, 0);
        const payloadWrite = requireWrite(writes, 1);
        expect(headerWrite).toMatchObject({
            endpoint: 0x01,
            packetSize: 16,
        });
        expect([...headerWrite.data]).toEqual(HEADER_BYTES);
        expect(payloadWrite).toMatchObject({
            endpoint: 0x01,
            packetSize: 512,
        });
        expect(payloadWrite.data).toHaveLength(PAYLOAD_BYTES);

        const unmaskedPixels = Array.from({ length: 8 }, (_, index) => removeXor(payloadWrite.data, index));
        expect(unmaskedPixels).toEqual([0x1f, 0x00, 0xe0, 0x07, 0x00, 0xf8, 0xff, 0xff]);
        expect([...payloadWrite.data.slice(PIXEL_BYTES_PER_ROW, PIXEL_BYTES_PER_ROW + 8)]).toEqual([
            0xe7, 0xf3, 0xe7, 0xff, 0xe7, 0xf3, 0xe7, 0xff,
        ]);
        expect([...payloadWrite.data.slice(ROW_BYTES, ROW_BYTES + 4)]).toEqual(XOR_MASK);
    });

    it('rejects a wrong-sized RGB frame before transport I/O', async () => {
        const { transport, writes } = createSuccessfulTransport();
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        await expect(protocol.submitFrame(new Uint8Array(RGB_FRAME_BYTES - 1))).resolves.toEqual({
            status: 'failed',
            reason: 'invalid-frame',
        });
        expect(writes).toHaveLength(0);
    });

    it('rejects a short header write without submitting payload data', async () => {
        const writes: CapturedWrite[] = [];
        const transport: PushDisplayTransport = {
            write(input) {
                writes.push(captureWrite(input));
                return Promise.resolve({ bytesWritten: 15 });
            },
        };
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        await expect(protocol.submitFrame(createRgbFrame())).resolves.toEqual({
            status: 'failed',
            reason: 'short-header-write',
        });
        expect(writes).toHaveLength(1);
    });

    it('rejects a short payload write', async () => {
        let writeIndex = 0;
        const transport: PushDisplayTransport = {
            write(input) {
                writeIndex += 1;
                if (writeIndex === 1) {
                    return Promise.resolve({ bytesWritten: input.data.length });
                }
                return Promise.resolve({ bytesWritten: input.data.length - 1 });
            },
        };
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        await expect(protocol.submitFrame(createRgbFrame())).resolves.toEqual({
            status: 'failed',
            reason: 'short-payload-write',
        });
        expect(writeIndex).toBe(2);
    });

    it('contains transport exceptions as explicit failed submissions', async () => {
        const transport: PushDisplayTransport = {
            write() {
                return Promise.reject(new Error('USB failed'));
            },
        };
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        await expect(protocol.submitFrame(createRgbFrame())).resolves.toEqual({
            status: 'failed',
            reason: 'transport-error',
        });
    });

    it('limits frame starts to 30 fps and coalesces queued models to the newest detached frame', async () => {
        const { transport, writes } = createSuccessfulTransport();
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        await expect(protocol.submitFrame(createRgbFrame())).resolves.toEqual({ status: 'written' });

        const supersededPixels = createRgbFrame(0, 255, 0);
        const newestPixels = createRgbFrame(255, 0, 0);
        const superseded = protocol.submitFrame(supersededPixels);
        const newest = protocol.submitFrame(newestPixels);
        newestPixels.fill(0);

        await expect(superseded).resolves.toEqual({ status: 'coalesced' });
        expect(writes).toHaveLength(2);
        expect(manual.pendingCount()).toBe(1);
        expect(manual.nextDelay()).toBeCloseTo(FRAME_INTERVAL_MS);

        manual.runNext();
        await expect(newest).resolves.toEqual({ status: 'written' });

        expect(writes).toHaveLength(4);
        const newestPayload = requireWrite(writes, 3).data;
        expect(removeXor(newestPayload, 0)).toBe(0x1f);
        expect(removeXor(newestPayload, 1)).toBe(0x00);
    });

    it('serializes transfers and coalesces while a frame is active', async () => {
        const firstHeader = createDeferred<Readonly<{ bytesWritten: number }>>();
        const writes: CapturedWrite[] = [];
        let writeIndex = 0;
        const transport: PushDisplayTransport = {
            write(input) {
                writes.push(captureWrite(input));
                writeIndex += 1;
                if (writeIndex === 1) {
                    return firstHeader.promise;
                }
                return Promise.resolve({ bytesWritten: input.data.length });
            },
        };
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        const active = protocol.submitFrame(createRgbFrame());
        await flushPromises();
        const superseded = protocol.submitFrame(createRgbFrame(0, 255, 0));
        const newest = protocol.submitFrame(createRgbFrame(0, 0, 255));

        await expect(superseded).resolves.toEqual({ status: 'coalesced' });
        expect(writes).toHaveLength(1);

        firstHeader.resolve({ bytesWritten: 16 });
        await expect(active).resolves.toEqual({ status: 'written' });
        expect(writes).toHaveLength(2);
        expect(manual.pendingCount()).toBe(1);

        manual.runNext();
        await expect(newest).resolves.toEqual({ status: 'written' });
        expect(writes).toHaveLength(4);
    });

    it('disconnects scheduled work and rejects every later submission without I/O', async () => {
        const { transport, writes } = createSuccessfulTransport();
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        await expect(protocol.submitFrame(createRgbFrame())).resolves.toEqual({ status: 'written' });
        const scheduled = protocol.submitFrame(createRgbFrame(255, 255, 255));
        expect(manual.pendingCount()).toBe(1);

        protocol.disconnect();
        protocol.disconnect();

        await expect(scheduled).resolves.toEqual({ status: 'disconnected' });
        await expect(protocol.submitFrame(createRgbFrame())).resolves.toEqual({ status: 'disconnected' });
        expect(manual.pendingCount()).toBe(0);
        expect(writes).toHaveLength(2);
    });

    it('disconnects an active header transfer and never starts its payload', async () => {
        const headerWrite = createDeferred<Readonly<{ bytesWritten: number }>>();
        const writes: CapturedWrite[] = [];
        const transport: PushDisplayTransport = {
            write(input) {
                writes.push(captureWrite(input));
                return headerWrite.promise;
            },
        };
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        const submission = protocol.submitFrame(createRgbFrame());
        await flushPromises();
        expect(writes).toHaveLength(1);

        protocol.disconnect();
        await expect(submission).resolves.toEqual({ status: 'disconnected' });

        headerWrite.resolve({ bytesWritten: 16 });
        await flushPromises();
        expect(writes).toHaveLength(1);
    });

    it('disconnects after the header and settles an active payload transfer', async () => {
        const payloadWrite = createDeferred<Readonly<{ bytesWritten: number }>>();
        const writes: CapturedWrite[] = [];
        let writeIndex = 0;
        const transport: PushDisplayTransport = {
            write(input) {
                writes.push(captureWrite(input));
                writeIndex += 1;
                if (writeIndex === 1) {
                    return Promise.resolve({ bytesWritten: input.data.length });
                }
                return payloadWrite.promise;
            },
        };
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });

        const submission = protocol.submitFrame(createRgbFrame());
        await flushPromises();
        expect(writes).toHaveLength(2);

        protocol.disconnect();
        await expect(submission).resolves.toEqual({ status: 'disconnected' });

        payloadWrite.resolve({ bytesWritten: PAYLOAD_BYTES });
        await flushPromises();
        expect(writes).toHaveLength(2);
    });

    it('rejects submission when already disconnected', async () => {
        const { transport, writes } = createSuccessfulTransport();
        const manual = createManualScheduler();
        const protocol = createPushDisplayProtocol({ transport, scheduler: manual.scheduler });
        protocol.disconnect();

        await expect(protocol.submitFrame(createRgbFrame())).resolves.toEqual({ status: 'disconnected' });
        expect(writes).toHaveLength(0);
    });
});
