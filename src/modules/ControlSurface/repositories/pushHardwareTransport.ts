import { invokeWithBinaryBody, isDesktopRuntime, desktopInvoke, desktopListen } from '#/utils/desktopBridge';

import { createPushDisplayProtocol, type PushDisplayProtocol } from './pushDisplayProtocol';
import {
    createPushMidiCodec,
    type PushMidiCodec,
    type PushMidiInputEvent,
    type PushMidiReplyRequest,
} from './pushMidiCodec';

type ConnectPushHardwareInput = Readonly<{
    model: 'push2' | 'push3';
    onMidiEvent(event: PushMidiInputEvent): void;
    onDisconnect(): void;
}>;

type PushMidiEventEnvelope = Readonly<{ payload: Readonly<{ data: readonly number[] }> }>;

type PendingReply = Readonly<{
    requestId: number;
    resolve(): void;
}>;

type ActiveSession = Readonly<{
    model: 'push2' | 'push3';
    codec: PushMidiCodec;
    display?: PushDisplayProtocol;
    unlisten: readonly (() => void)[];
}>;

const DISPLAY_FRAME_BYTES = 960 * 160 * 3;
const DISPLAY_PAYLOAD_MAX_BYTES = 160 * 2_048;
const REPLY_TIMEOUT_MS = 2_000;

let activeSession: ActiveSession | undefined;
let operation = Promise.resolve();

function isPushMidiEventEnvelope(value: unknown): value is PushMidiEventEnvelope {
    if (typeof value !== 'object' || value === null || !('payload' in value)) {
        return false;
    }
    const { payload } = value;
    if (typeof payload !== 'object' || payload === null || !('data' in payload) || !Array.isArray(payload.data)) {
        return false;
    }
    if (payload.data.length === 0 || payload.data.length > 23) {
        return false;
    }
    return payload.data.every(
        (byte): byte is number => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255
    );
}

function serialize<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = operation.then(task, task);
    operation = result.then(
        () => undefined,
        () => undefined
    );
    return result;
}

async function closeSession(session: ActiveSession | undefined): Promise<void> {
    session?.display?.disconnect();
    session?.codec.resetSession();
    for (const stopListening of session?.unlisten ?? []) {
        stopListening();
    }
    await desktopInvoke('close_push_transport');
}

async function connect({ model, onMidiEvent, onDisconnect }: ConnectPushHardwareInput): Promise<void> {
    return serialize(async () => {
        if (!isDesktopRuntime()) {
            throw new Error('Ableton Push hardware requires the Sourdaw desktop app');
        }
        if (activeSession) {
            if (activeSession.model === model) {
                return;
            }
            throw new Error(`Ableton ${activeSession.model} is already connected`);
        }

        const codec = createPushMidiCodec();
        let display: PushDisplayProtocol | undefined;
        const unlisten: (() => void)[] = [];
        let nativeOpened = false;
        let pendingReply: PendingReply | undefined;

        function handleMidiEnvelope(envelope: unknown): void {
            if (!isPushMidiEventEnvelope(envelope)) {
                return;
            }
            const bytes = envelope.payload.data;
            if (pendingReply) {
                const accepted = codec.acceptReply(pendingReply.requestId, bytes);
                if (accepted.status === 'accepted') {
                    const completed = pendingReply;
                    pendingReply = undefined;
                    completed.resolve();
                    return;
                }
                if (accepted.reason !== 'not-a-reply') {
                    return;
                }
            }

            const decoded = codec.decode(bytes);
            if (decoded.status === 'event') {
                onMidiEvent(decoded.event);
            }
        }

        function handleNativeDisconnect(): void {
            display?.disconnect();
            codec.resetSession();
            for (const stopListening of unlisten) {
                stopListening();
            }
            activeSession = undefined;
            onDisconnect();
        }

        async function requestReply(request: PushMidiReplyRequest): Promise<void> {
            const started = codec.beginRequest(request);
            if (started.status !== 'started') {
                throw new Error(`Push 2 MIDI request rejected: ${started.reason}`);
            }

            const reply = new Promise<void>((resolve) => {
                pendingReply = { requestId: started.requestId, resolve };
            });
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const deadline = new Promise<never>((_resolve, reject) => {
                timeout = setTimeout(() => {
                    codec.cancelRequest(started.requestId);
                    pendingReply = undefined;
                    reject(new Error(`Push 2 ${request.kind} reply timed out`));
                }, REPLY_TIMEOUT_MS);
            });
            const send = invokeWithBinaryBody({
                command: 'send_push_midi',
                bytes: started.bytes,
                maxBytes: 23,
            });
            try {
                await Promise.race([Promise.all([send, reply]), deadline]);
            } finally {
                clearTimeout(timeout);
                if (pendingReply?.requestId === started.requestId) {
                    codec.cancelRequest(started.requestId);
                    pendingReply = undefined;
                }
            }
        }

        try {
            unlisten.push(await desktopListen('push-midi-message', handleMidiEnvelope));
            unlisten.push(await desktopListen('push-disconnected', handleNativeDisconnect));
            await desktopInvoke('open_push_transport', { model });
            nativeOpened = true;

            if (model === 'push2') {
                await requestReply({ kind: 'identity' });
                await requestReply({ kind: 'midi-mode', mode: 0 });

                display = createPushDisplayProtocol({
                    transport: {
                        async write({ data }) {
                            await invokeWithBinaryBody({
                                command: 'write_push2_display',
                                bytes: data,
                                maxBytes: DISPLAY_PAYLOAD_MAX_BYTES,
                            });
                            return { bytesWritten: data.byteLength };
                        },
                    },
                    scheduler: {
                        now: () => performance.now(),
                        schedule(delayMs, callback) {
                            const timeout = setTimeout(callback, delayMs);
                            return () => clearTimeout(timeout);
                        },
                    },
                });
                const initialFrame = await display.submitFrame(new Uint8Array(DISPLAY_FRAME_BYTES));
                if (initialFrame.status !== 'written') {
                    throw new Error(`Push 2 display initialization failed: ${initialFrame.status}`);
                }
            }

            activeSession = { model, codec, display, unlisten };
        } catch (error) {
            if (pendingReply) {
                codec.cancelRequest(pendingReply.requestId);
                pendingReply = undefined;
            }
            display?.disconnect();
            codec.resetSession();
            for (const stopListening of unlisten) {
                stopListening();
            }
            if (nativeOpened) {
                await desktopInvoke('close_push_transport').catch(() => undefined);
            }
            throw error;
        }
    });
}

async function disconnect(): Promise<void> {
    return serialize(async () => {
        const session = activeSession;
        activeSession = undefined;
        await closeSession(session);
    });
}

export const pushHardwareTransport = Object.freeze({ connect, disconnect });
