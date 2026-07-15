import { type SourceWithFade } from './playheadScheduler';

export function stopActiveSources(sources: AudioBufferSourceNode[], ctx: BaseAudioContext): void {
    const now = ctx.currentTime;
    for (const src of sources as SourceWithFade[]) {
        try {
            if (src.fadeGainNode) {
                src.fadeGainNode.gain.cancelScheduledValues(now);
                src.fadeGainNode.gain.setValueAtTime(src.fadeGainNode.gain.value, now);
                src.fadeGainNode.gain.linearRampToValueAtTime(0, now + 0.005);
                src.stop(now + 0.005);
            } else {
                src.stop(now + 0.005);
            }
        } catch {
            /* already stopped */
        }
    }
    sources.length = 0;
}
