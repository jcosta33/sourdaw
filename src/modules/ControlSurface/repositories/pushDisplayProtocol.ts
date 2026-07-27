export type PushDisplayTransportWriteInput = Readonly<{
    endpoint: number;
    data: Uint8Array;
    packetSize: number;
}>;

export type PushDisplayTransport = Readonly<{
    write(input: PushDisplayTransportWriteInput): Promise<Readonly<{ bytesWritten: number }>>;
}>;

export type PushDisplayScheduler = Readonly<{
    now(): number;
    schedule(delayMs: number, callback: () => void): () => void;
}>;

export type PushDisplaySubmissionResult =
    | Readonly<{ status: 'written' }>
    | Readonly<{ status: 'coalesced' }>
    | Readonly<{ status: 'disconnected' }>
    | Readonly<{
          status: 'failed';
          reason: 'invalid-frame' | 'header-write-count-mismatch' | 'payload-write-count-mismatch' | 'transport-error';
      }>;

export type PushDisplayProtocol = Readonly<{
    submitFrame(rgbPixels: Uint8Array): Promise<PushDisplaySubmissionResult>;
    disconnect(): void;
}>;

export type CreatePushDisplayProtocolInput = Readonly<{
    transport: PushDisplayTransport;
    scheduler: PushDisplayScheduler;
}>;

const DISPLAY_WIDTH = 960;
const DISPLAY_HEIGHT = 160;
const RGB_BYTES_PER_PIXEL = 3;
const RGB_FRAME_BYTES = DISPLAY_WIDTH * DISPLAY_HEIGHT * RGB_BYTES_PER_PIXEL;
const PIXEL_BYTES_PER_ROW = DISPLAY_WIDTH * 2;
const ROW_BYTES = 2_048;
const PAYLOAD_BYTES = DISPLAY_HEIGHT * ROW_BYTES;
const HEADER_PACKET_SIZE = 16;
const PAYLOAD_PACKET_SIZE = 512;
const DISPLAY_ENDPOINT = 0x01;
const FRAME_INTERVAL_MS = 1_000 / 30;
const FRAME_HEADER = new Uint8Array([0xff, 0xcc, 0xaa, 0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const XOR_MASK = new Uint8Array([0xe7, 0xf3, 0xe7, 0xff]);

const WRITTEN_RESULT: PushDisplaySubmissionResult = Object.freeze({ status: 'written' });
const COALESCED_RESULT: PushDisplaySubmissionResult = Object.freeze({ status: 'coalesced' });
const DISCONNECTED_RESULT: PushDisplaySubmissionResult = Object.freeze({ status: 'disconnected' });
const INVALID_FRAME_RESULT: PushDisplaySubmissionResult = Object.freeze({
    status: 'failed',
    reason: 'invalid-frame',
});
const HEADER_WRITE_COUNT_MISMATCH_RESULT: PushDisplaySubmissionResult = Object.freeze({
    status: 'failed',
    reason: 'header-write-count-mismatch',
});
const PAYLOAD_WRITE_COUNT_MISMATCH_RESULT: PushDisplaySubmissionResult = Object.freeze({
    status: 'failed',
    reason: 'payload-write-count-mismatch',
});
const TRANSPORT_ERROR_RESULT: PushDisplaySubmissionResult = Object.freeze({
    status: 'failed',
    reason: 'transport-error',
});

type PendingSubmission = {
    pixels: Uint8Array;
    settled: boolean;
    resolve(result: PushDisplaySubmissionResult): void;
};

function encodePayload(rgbPixels: Uint8Array): Uint8Array {
    const payload = new Uint8Array(PAYLOAD_BYTES);

    for (let row = 0; row < DISPLAY_HEIGHT; row += 1) {
        const sourceRowOffset = row * DISPLAY_WIDTH * RGB_BYTES_PER_PIXEL;
        const targetRowOffset = row * ROW_BYTES;

        for (let column = 0; column < DISPLAY_WIDTH; column += 1) {
            const sourceOffset = sourceRowOffset + column * RGB_BYTES_PER_PIXEL;
            const targetOffset = targetRowOffset + column * 2;
            const red = (rgbPixels[sourceOffset] ?? 0) >> 3;
            const green = (rgbPixels[sourceOffset + 1] ?? 0) >> 2;
            const blue = (rgbPixels[sourceOffset + 2] ?? 0) >> 3;
            const bgr565 = (blue << 11) | (green << 5) | red;

            payload[targetOffset] = bgr565 & 0xff;
            payload[targetOffset + 1] = bgr565 >> 8;
        }

        const fillerStart = targetRowOffset + PIXEL_BYTES_PER_ROW;
        const rowEnd = targetRowOffset + ROW_BYTES;
        payload.fill(0, fillerStart, rowEnd);
    }

    for (let index = 0; index < payload.length; index += 1) {
        const payloadByte = payload[index] ?? 0;
        const maskByte = XOR_MASK[index % XOR_MASK.length] ?? 0;
        payload[index] = payloadByte ^ maskByte;
    }

    return payload;
}

function settleSubmission(submission: PendingSubmission, result: PushDisplaySubmissionResult): void {
    if (submission.settled) {
        return;
    }

    submission.settled = true;
    submission.resolve(result);
}

export function createPushDisplayProtocol({
    transport,
    scheduler,
}: CreatePushDisplayProtocolInput): PushDisplayProtocol {
    let disconnected = false;
    let activeSubmission: PendingSubmission | undefined;
    let queuedSubmission: PendingSubmission | undefined;
    let cancelScheduledStart: (() => void) | undefined;
    let lastFrameStartedAt = Number.NEGATIVE_INFINITY;

    function shouldStopSubmission(submission: PendingSubmission): boolean {
        return disconnected || submission.settled;
    }

    function scheduleQueuedSubmission(): void {
        if (disconnected || activeSubmission || cancelScheduledStart || !queuedSubmission) {
            return;
        }

        const elapsed = scheduler.now() - lastFrameStartedAt;
        const delay = Math.max(0, FRAME_INTERVAL_MS - elapsed);
        if (delay > 0) {
            cancelScheduledStart = scheduler.schedule(delay, () => {
                cancelScheduledStart = undefined;
                scheduleQueuedSubmission();
            });
            return;
        }

        const submission = queuedSubmission;
        queuedSubmission = undefined;
        activeSubmission = submission;
        lastFrameStartedAt = scheduler.now();
        void writeSubmission(submission);
    }

    async function writeSubmission(submission: PendingSubmission): Promise<void> {
        try {
            const payload = encodePayload(submission.pixels);
            if (shouldStopSubmission(submission)) {
                return;
            }

            const headerResult = await transport.write({
                endpoint: DISPLAY_ENDPOINT,
                data: FRAME_HEADER.slice(),
                packetSize: HEADER_PACKET_SIZE,
            });
            if (shouldStopSubmission(submission)) {
                return;
            }
            if (headerResult.bytesWritten !== FRAME_HEADER.length) {
                settleSubmission(submission, HEADER_WRITE_COUNT_MISMATCH_RESULT);
                return;
            }

            const payloadResult = await transport.write({
                endpoint: DISPLAY_ENDPOINT,
                data: payload,
                packetSize: PAYLOAD_PACKET_SIZE,
            });
            if (shouldStopSubmission(submission)) {
                return;
            }
            if (payloadResult.bytesWritten !== payload.length) {
                settleSubmission(submission, PAYLOAD_WRITE_COUNT_MISMATCH_RESULT);
                return;
            }

            settleSubmission(submission, WRITTEN_RESULT);
        } catch {
            if (disconnected) {
                settleSubmission(submission, DISCONNECTED_RESULT);
            } else {
                settleSubmission(submission, TRANSPORT_ERROR_RESULT);
            }
        } finally {
            if (activeSubmission === submission) {
                activeSubmission = undefined;
            }
            scheduleQueuedSubmission();
        }
    }

    function submitFrame(rgbPixels: Uint8Array): Promise<PushDisplaySubmissionResult> {
        if (disconnected) {
            return Promise.resolve(DISCONNECTED_RESULT);
        }
        if (rgbPixels.length !== RGB_FRAME_BYTES) {
            return Promise.resolve(INVALID_FRAME_RESULT);
        }

        return new Promise((resolve) => {
            const submission: PendingSubmission = {
                pixels: rgbPixels.slice(),
                settled: false,
                resolve,
            };

            if (queuedSubmission) {
                settleSubmission(queuedSubmission, COALESCED_RESULT);
            }
            queuedSubmission = submission;
            scheduleQueuedSubmission();
        });
    }

    function disconnect(): void {
        if (disconnected) {
            return;
        }

        disconnected = true;
        if (cancelScheduledStart) {
            cancelScheduledStart();
            cancelScheduledStart = undefined;
        }
        if (queuedSubmission) {
            settleSubmission(queuedSubmission, DISCONNECTED_RESULT);
            queuedSubmission = undefined;
        }
        if (activeSubmission) {
            settleSubmission(activeSubmission, DISCONNECTED_RESULT);
        }
    }

    return Object.freeze({
        submitFrame,
        disconnect,
    });
}
