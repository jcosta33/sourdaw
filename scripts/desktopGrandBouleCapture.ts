import { type JSHandle, type Page } from 'playwright';

export const RECEIVE_WORKLET = `
class Receive extends AudioWorkletProcessor {
    constructor() {
        super();
        this.pending = null;
        this.ring = new Float32Array(262144);
        this.end = null;
        this.first = null;
        this.broken = false;
        this.port.onmessage = ({ data }) => {
            this.pending = { start: data.start === 0 ? null : data.start, count: data.count };
        };
    }
    process(inputs) {
        const channels = inputs[0];
        if (this.first === null && (!channels || !channels[0] || channels[0].length === 0)) {
            return true;
        }
        if (!channels || !channels[0] || channels[0].length !== 128 ||
            (this.end !== null && this.end !== currentFrame)) {
            this.broken = true;
        }
        if (this.broken) {
            if (this.pending) {
                this.port.postMessage({ error: 'capture-continuity-lost' });
                this.pending = null;
            }
            return true;
        }
        if (this.first === null) {
            this.first = currentFrame;
        }
        if (this.pending && this.pending.start === null) {
            this.pending.start = currentFrame;
        }
        for (let i = 0; i < 128; i++) {
            let value = 0;
            for (const channel of channels) {
                value += channel[i] / channels.length;
            }
            this.ring[(currentFrame + i) % this.ring.length] = value;
        }
        this.end = currentFrame + 128;
        const pending = this.pending;
        if (pending && this.end >= pending.start + pending.count) {
            if (pending.start < this.first || pending.start < this.end - this.ring.length) {
                this.port.postMessage({ error: 'capture-window-stale' });
            } else {
                const values = new Float32Array(pending.count);
                for (let i = 0; i < pending.count; i++) {
                    values[i] = this.ring[(pending.start + i) % this.ring.length];
                }
                this.port.postMessage({ firstFrame: pending.start,
                    endFrame: pending.start + pending.count, sampleRate, values }, [values.buffer]);
            }
            this.pending = null;
        }
        return true;
    }
}
registerProcessor('sourdaw-observer-receive', Receive);
`;

const BLACKHOLE_INPUT = 'BlackHole 2ch';
const INPUT_FAILURES = [
    'capture-media-devices-unavailable',
    'capture-device-enumeration-failed',
    'capture-named-input-unavailable',
    'capture-returned-input-mismatch',
    'capture-raw-input-unavailable',
    'capture-context-creation-failed',
];
const MEDIA_ERRORS = [
    'AbortError',
    'NotAllowedError',
    'NotFoundError',
    'NotReadableError',
    'OverconstrainedError',
    'SecurityError',
];

class CaptureAdmissionError extends Error {}

export function captureAdmissionFailure(error: unknown): string {
    if (error instanceof CaptureAdmissionError) {
        return error.message;
    }
    return 'capture-admission-interrupted';
}

function admissionError(stage: 'input' | 'worklet' | 'graph', error: unknown): CaptureAdmissionError {
    // Playwright sends renderer errors across CDP as stack text. Retain only known codes.
    const firstLine = (error instanceof Error ? error.message : '').split('\n', 1)[0] ?? '';
    const detail = firstLine.replace(/^(?:page|jsHandle)\.evaluate(?:Handle)?: /u, '');
    const [name, message] = detail.split(': ', 2);
    if (stage === 'input' && name === 'Error' && message !== undefined && INPUT_FAILURES.includes(message)) {
        return new CaptureAdmissionError(message, { cause: error });
    }
    const reason = MEDIA_ERRORS.find((candidate) => candidate === name);
    const code = reason === undefined ? `capture-${stage}-failed` : `capture-${stage}-${reason}`;
    return new CaptureAdmissionError(code, { cause: error });
}

/** Runs in the packaged app renderer. The caller verifies the OS input before the request. */
export async function openBlackHoleMedia({
    device,
    allowHiddenDefault = false,
}: {
    device: string;
    allowHiddenDefault?: boolean;
}) {
    const runtimeNavigator: { mediaDevices?: MediaDevices } = navigator;
    const media = runtimeNavigator.mediaDevices;
    if (!media) {
        throw new Error('capture-media-devices-unavailable');
    }
    const listInputs = async () => {
        try {
            return (await media.enumerateDevices()).filter((entry) => entry.kind === 'audioinput');
        } catch (error) {
            throw new Error('capture-device-enumeration-failed', { cause: error });
        }
    };
    // Chromium appends this suffix to Core Audio devices with virtual transport.
    const matchesDeviceLabel = (label: string) => label === device || label === `${device} (Virtual)`;
    const findNamed = (inputs: MediaDeviceInfo[]) =>
        inputs.filter((entry) => matchesDeviceLabel(entry.label) && entry.deviceId && entry.deviceId !== 'default');
    function selectDeviceId(inputs: MediaDeviceInfo[]): string {
        const named = findNamed(inputs);
        if (named.length > 1 || (named.length === 0 && (!allowHiddenDefault || inputs.some((entry) => entry.label)))) {
            throw new Error('capture-named-input-unavailable');
        }
        // An isolated runner can use its verified default until Chromium reveals the labels.
        return named[0]?.deviceId ?? 'default';
    }
    async function verifyDefaultAlias(label: string, groupId: string | undefined): Promise<boolean> {
        if (!label || !groupId) {
            return false;
        }
        // Chromium decorates the default label. The group revealed after opening
        // the stream ties that alias to the exact named device in any locale.
        const revealed = await listInputs();
        const devices = findNamed(revealed);
        const alias = revealed.find((entry) => entry.deviceId === 'default');
        return (
            devices.length === 1 &&
            devices[0]?.groupId === groupId &&
            alias?.groupId === groupId &&
            alias.label === label
        );
    }
    const deviceId = selectDeviceId(await listInputs());
    const stream = await media.getUserMedia({
        audio: {
            deviceId: { exact: deviceId },
            echoCancellation: { exact: false },
            noiseSuppression: { exact: false },
            autoGainControl: { exact: false },
        },
        video: false,
    });
    try {
        const [track, ...extra] = stream.getAudioTracks();
        const settings = track?.getSettings();
        if (!track || extra.length > 0 || settings?.deviceId !== deviceId) {
            throw new Error('capture-returned-input-mismatch');
        }
        let verifiedInput = matchesDeviceLabel(track.label);
        if (deviceId === 'default') {
            verifiedInput = await verifyDefaultAlias(track.label, settings.groupId);
        }
        if (!verifiedInput) {
            throw new Error('capture-returned-input-mismatch');
        }
        if (
            settings.echoCancellation === true ||
            settings.noiseSuppression === true ||
            settings.autoGainControl === true
        ) {
            throw new Error('capture-raw-input-unavailable');
        }
        let context: AudioContext;
        try {
            context = new AudioContext();
        } catch (error) {
            throw new Error('capture-context-creation-failed', { cause: error });
        }
        return { stream, context, track, input: device };
    } catch (error) {
        for (const capturedTrack of stream.getTracks()) {
            capturedTrack.stop();
        }
        throw error;
    }
}

/** Isolated receive-only graph. It never connects to any audible destination. */
export async function captureBlackHole(page: Pick<Page, 'evaluateHandle'>, allowHiddenDefault = false) {
    const media = await page
        .evaluateHandle(openBlackHoleMedia, { device: BLACKHOLE_INPUT, allowHiddenDefault })
        .catch((error: unknown) => {
            throw admissionError('input', error);
        });
    let stage: 'worklet' | 'graph' = 'worklet';
    try {
        await media.evaluate(async (receiver, source) => {
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            try {
                await receiver.context.audioWorklet.addModule(url);
            } finally {
                URL.revokeObjectURL(url);
            }
        }, RECEIVE_WORKLET);
        stage = 'graph';
        return await connectCapture(media);
    } catch (error) {
        const failure = admissionError(stage, error);
        try {
            await media.evaluate(async (receiver) => {
                for (const capturedTrack of receiver.stream.getTracks()) {
                    capturedTrack.stop();
                }
                await receiver.context.close();
            });
        } catch (cleanupError) {
            throw new CaptureAdmissionError(failure.message, {
                cause: new AggregateError([error, cleanupError], 'Capture admission and receiver cleanup failed'),
            });
        }
        throw failure;
    } finally {
        await media.dispose();
    }
}

// A separate renderer evaluation keeps graph connection and bounded receive lifecycle together.
async function connectCapture(media: JSHandle<Awaited<ReturnType<typeof openBlackHoleMedia>>>) {
    return await media.evaluateHandle(async (receiver) => {
        const { context, stream, track } = receiver;
        const source = context.createMediaStreamSource(stream);
        const sink = new AudioWorkletNode(context, 'sourdaw-observer-receive', {
            numberOfInputs: 1,
            numberOfOutputs: 0,
        });
        source.connect(sink);
        await context.resume();
        let busy = false;
        return {
            input: receiver.input,
            frame: () => Math.ceil((context.currentTime * context.sampleRate) / 128) * 128,
            sample: async (start: number, count: number) => {
                if (busy || context.state !== 'running' || track.readyState !== 'live') {
                    throw new Error('capture-clock-unavailable');
                }
                busy = true;
                try {
                    return await new Promise<{
                        firstFrame: number;
                        endFrame: number;
                        sampleRate: number;
                        values: number[];
                    }>((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('capture-clock-stale')), 8000);
                        sink.port.onmessage = ({ data }: MessageEvent<unknown>) => {
                            clearTimeout(timer);
                            if (typeof data !== 'object' || data === null || 'error' in data) {
                                reject(new Error('capture-message-invalid'));
                                return;
                            }
                            if (
                                !('firstFrame' in data) ||
                                typeof data.firstFrame !== 'number' ||
                                !('endFrame' in data) ||
                                typeof data.endFrame !== 'number' ||
                                !('sampleRate' in data) ||
                                typeof data.sampleRate !== 'number' ||
                                !('values' in data) ||
                                !(data.values instanceof Float32Array)
                            ) {
                                reject(new Error('capture-message-invalid'));
                                return;
                            }
                            resolve({
                                firstFrame: data.firstFrame,
                                endFrame: data.endFrame,
                                sampleRate: data.sampleRate,
                                values: Array.from(data.values),
                            });
                        };
                        sink.port.postMessage({ start, count });
                    });
                } finally {
                    busy = false;
                }
            },
            close: async () => {
                for (const capturedTrack of stream.getTracks()) {
                    capturedTrack.stop();
                }
                source.disconnect();
                sink.disconnect();
                await context.close();
            },
        };
    });
}
