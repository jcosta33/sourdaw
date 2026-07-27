import { type OfflineDeviceNode } from '../types';

// ── Reverb (algorithmic) ─────────────────────────────────────────────────

const reverbImpulses = new WeakMap<BaseAudioContext, AudioBuffer>();

function createDeterministicImpulse(ctx: BaseAudioContext): AudioBuffer {
    const cached = reverbImpulses.get(ctx);
    if (cached) {
        return cached;
    }

    const length = ctx.sampleRate * 2;
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        let state = (0x9e3779b9 ^ ctx.sampleRate ^ ((channel + 1) * 0x85ebca6b)) >>> 0;
        for (let index = 0; index < length; index++) {
            state ^= state << 13;
            state ^= state >>> 17;
            state ^= state << 5;
            const noise = (state >>> 0) / 0x1_0000_0000;
            data[index] = (noise * 2 - 1) * Math.exp(-index / (ctx.sampleRate * 0.5));
        }
    }

    reverbImpulses.set(ctx, impulse);
    return impulse;
}

export function createReverb(ctx: BaseAudioContext): OfflineDeviceNode {
    const dry = ctx.createGain();
    dry.gain.value = 0.7;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    const predelay = ctx.createDelay(1);
    predelay.delayTime.value = 0.01;
    const lowcut = ctx.createBiquadFilter();
    lowcut.type = 'highpass';
    lowcut.frequency.value = 80;
    lowcut.Q.value = 0.7;
    const convolver = ctx.createConvolver();
    convolver.buffer = createDeterministicImpulse(ctx);
    const merger = ctx.createGain();
    const splitter = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(predelay);
    predelay.connect(lowcut);
    lowcut.connect(convolver);
    convolver.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut],
    };
}
