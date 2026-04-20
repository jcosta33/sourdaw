import { type OfflineDeviceNode } from '../types';

import { IR_GENERATORS } from './helpers';

export function createConvolutionReverb(ctx: BaseAudioContext): OfflineDeviceNode {
    const splitter = ctx.createGain();
    const dry = ctx.createGain();
    dry.gain.value = 0.6;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    const predelay = ctx.createDelay(0.5);
    predelay.delayTime.value = 0.01;
    const lowcut = ctx.createBiquadFilter();
    lowcut.type = 'highpass';
    lowcut.frequency.value = 60;
    lowcut.Q.value = 0.7;
    const highcut = ctx.createBiquadFilter();
    highcut.type = 'lowpass';
    highcut.frequency.value = 12000;
    highcut.Q.value = 0.7;
    const convolver = ctx.createConvolver();
    convolver.buffer = IR_GENERATORS['studio-a']!(ctx.sampleRate);
    const merger = ctx.createGain();
    splitter.connect(dry);
    splitter.connect(predelay);
    predelay.connect(lowcut);
    lowcut.connect(highcut);
    highcut.connect(convolver);
    convolver.connect(wet);
    dry.connect(merger);
    wet.connect(merger);
    return {
        inputNode: splitter,
        outputNode: merger,
        nodes: [splitter, dry, wet, convolver, merger, predelay, lowcut, highcut],
    };
}
