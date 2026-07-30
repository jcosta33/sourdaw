import type { TrackNode } from './TrackNode';
import type { BusStrip } from '../models/AudioEngineState';

export class BusNode {
    public strip: BusStrip;

    constructor(
        public busId: string,
        private trackNode: TrackNode
    ) {
        this.strip = {
            busId,
            gainNode: trackNode.strip.gainNode,
            analyserNode: trackNode.strip.analyserNode,
        };
    }

    public setGain(gain: number): void {
        this.trackNode.setGain(gain);
    }

    public getPeakLevel(): number {
        return this.trackNode.getPeakLevel();
    }

    public dispose(): void {
        // The facade owns no nodes. The paired TrackNode owns and disposes the
        // input, device chain, mixer nodes, meter, and output edge.
    }
}
