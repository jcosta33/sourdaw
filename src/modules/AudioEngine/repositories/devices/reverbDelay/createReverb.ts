import { type OfflineDeviceNode } from '../types';

// ── Reverb (algorithmic) ─────────────────────────────────────────────────

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
    const len = ctx.sampleRate * 2;
    const impulse = new AudioBuffer({ numberOfChannels: 2, length: len, sampleRate: ctx.sampleRate });
    for (let ch = 0; ch < 2; ch++) {
        const data = impulse.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.5));
        }
    }
    convolver.buffer = impulse;
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