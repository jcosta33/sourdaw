import { type OfflineDeviceNode } from '../types';

import { applyReverbImpulseShape, DEFAULT_REVERB_SHAPE } from './reverbImpulse';

// ── Reverb (algorithmic) ─────────────────────────────────────────────────

export function createReverb(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
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
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(predelay);
    predelay.connect(lowcut);
    lowcut.connect(convolver);
    convolver.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    const dn: OfflineDeviceNode = {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut],
        namedNodes: { splitter, dry, wet, convolver, merger, predelay, lowcut },
    };
    applyReverbImpulseShape(dn, ctx, DEFAULT_REVERB_SHAPE);
    return dn;
}
