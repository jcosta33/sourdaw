import { createHash } from 'node:crypto';

import reference from './mainMeteringReference.json';

export const mainMeteringReference = reference.cases;

/** Fixed inputs captured against the original batch meters before incremental reuse. */
export function createMainMeteringInput(input: (typeof mainMeteringReference)[number]) {
    const { rate, name } = input;
    const length = name === 'short' ? Math.round(rate * 0.4) - 1 : rate * 2 + 137;
    const channels = Array.from({ length: 2 }, (_, channel) =>
        Float32Array.from({ length }, (_, frame) => {
            if (name === 'silence') {
                return 0;
            }
            if (name === 'edge-tail') {
                if (frame === 0) {
                    return channel ? -0.9 : 1.4;
                }
                if (frame === length - 1) {
                    return channel ? 1.2 : -1.6;
                }
                return frame > length - 64 ? Math.sin(frame * 1.3) * 0.7 : 0;
            }
            let amplitude = 0.1;
            if (name === 'absolute-gate') {
                amplitude = frame < rate ? 0.0003 : 0.000003;
            }
            if (name === 'relative-gate') {
                if (frame < rate / 2) {
                    amplitude = 0.5;
                } else if (frame < rate * 1.5) {
                    amplitude = 0.005;
                } else {
                    amplitude = 0.05;
                }
            }
            if (name === 'non-finite' && frame === 4095) {
                return Number.NaN;
            }
            if (name === 'non-finite' && frame === 4096) {
                return channel ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
            }
            return amplitude * Math.sin((2 * Math.PI * (channel ? 733 : 1000) * frame) / rate + channel * 0.37);
        })
    );

    const hash = createHash('sha256');
    for (const channel of channels) {
        hash.update(new Uint8Array(channel.buffer));
    }
    return { channels, length, inputSha256: hash.digest('hex') };
}
