import type { BusStrip } from '../models/AudioEngineState';

export class BusNode {
    public strip: BusStrip;

    constructor(
        public busId: string,
        private context: BaseAudioContext,
        masterGainNode: GainNode
    ) {
        const gainNode = context.createGain();
        gainNode.gain.value = 1;

        const analyserNode = context.createAnalyser();
        analyserNode.fftSize = 256;
        analyserNode.smoothingTimeConstant = 0.8;

        gainNode.connect(analyserNode);
        analyserNode.connect(masterGainNode);

        this.strip = {
            busId,
            gainNode,
            analyserNode,
            meterBuffer: new Float32Array(analyserNode.frequencyBinCount),
        };
    }

    public setGain(gain: number): void {
        this.strip.gainNode.gain.setTargetAtTime(Math.max(0, Math.min(2, gain)), this.context.currentTime, 0.01);
    }

    public getPeakLevel(): number {
        const data = this.strip.meterBuffer;
        if (data) {
            this.strip.analyserNode.getFloatTimeDomainData(data as any);
        }
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]!);
            if (abs > peak) {
                peak = abs;
            }
        }
        return peak;
    }

    public dispose(): void {
        this.strip.gainNode.disconnect();
        this.strip.analyserNode.disconnect();
    }
}
