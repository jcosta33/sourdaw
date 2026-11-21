import { compressorAutoMakeupCancellers } from './compressorAutoMakeupCancellers';

/** Stops the probe and detaches the twin chain the graph does not own. */
export function releaseCompressorAutoMakeup(trim: GainNode): void {
    const canceller = compressorAutoMakeupCancellers.get(trim);
    if (!canceller) {
        return;
    }
    compressorAutoMakeupCancellers.delete(trim);
    canceller.probe.stop();
    for (const node of [canceller.probe, canceller.twin, canceller.scale, canceller.reciprocal]) {
        node.disconnect();
    }
}
