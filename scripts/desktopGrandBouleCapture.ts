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

/** Isolated receive-only graph. It never connects to any audible destination. */
export async function captureBlackHole(page: Page) {
    const media = await page.evaluateHandle(async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const named = devices.filter((device) => device.kind === 'audioinput' && device.label === 'BlackHole 2ch');
        if (
            named.length > 1 ||
            (named.length === 0 && devices.some((device) => device.kind === 'audioinput' && device.label))
        ) {
            throw new Error('named-input-unavailable');
        }
        // Caller verified both OS defaults before requesting the otherwise concealed default.
        const constraints: MediaTrackConstraints = {
            echoCancellation: { exact: false },
            noiseSuppression: { exact: false },
            autoGainControl: { exact: false },
        };
        if (named[0]) {
            constraints.deviceId = { exact: named[0].deviceId };
        }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints, video: false });
        const tracks = stream.getAudioTracks();
        const track = tracks[0];
        const settings = track?.getSettings();
        if (
            tracks.length !== 1 ||
            track?.label !== 'BlackHole 2ch' ||
            !settings?.deviceId ||
            (named[0] && settings.deviceId !== named[0].deviceId) ||
            settings.echoCancellation === true ||
            settings.noiseSuppression === true ||
            settings.autoGainControl === true
        ) {
            for (const capturedTrack of stream.getTracks()) {
                capturedTrack.stop();
            }
            throw new Error('returned-input-mismatch');
        }
        try {
            const context = new AudioContext();
            return { stream, context, track, input: track.label, deviceId: settings.deviceId };
        } catch (error) {
            for (const capturedTrack of stream.getTracks()) {
                capturedTrack.stop();
            }
            throw error;
        }
    });
    try {
        await media.evaluate(async (receiver, source) => {
            const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
            try {
                await receiver.context.audioWorklet.addModule(url);
            } finally {
                URL.revokeObjectURL(url);
            }
        }, RECEIVE_WORKLET);
        return await connectCapture(media);
    } catch (error) {
        await media.evaluate(async (receiver) => {
            for (const capturedTrack of receiver.stream.getTracks()) {
                capturedTrack.stop();
            }
            await receiver.context.close();
        });
        throw error;
    } finally {
        await media.dispose();
    }
}

// A separate renderer evaluation keeps graph connection and bounded receive lifecycle together.
async function connectCapture(
    media: JSHandle<{
        stream: MediaStream;
        context: AudioContext;
        track: MediaStreamTrack;
        input: string;
        deviceId: string;
    }>
) {
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
