import { detectTransients } from '../models/TransientDetection';
import { type TransientOnsetWorkerRequest } from '../models/TransientOnsetWorker';

self.onmessage = (event: MessageEvent<TransientOnsetWorkerRequest>): void => {
    try {
        const { channels, sampleRate, sensitivity } = event.data;
        const mono = new Float32Array(channels[0]?.length ?? 0);
        for (let frame = 0; frame < mono.length; frame++) {
            let sum = 0;
            for (const channel of channels) {
                const sample = channel[frame];
                if (sample === undefined || !Number.isFinite(sample)) {
                    throw new Error('Invalid PCM.');
                }
                sum += sample;
            }
            mono[frame] = sum / channels.length;
        }
        self.postMessage({ status: 'complete', hits: detectTransients(mono, sampleRate, sensitivity) });
    } catch {
        self.postMessage({ status: 'failed', code: 'analysis-failed' });
    }
};
