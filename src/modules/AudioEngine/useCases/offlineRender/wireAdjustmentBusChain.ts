import { type OfflineAdjustmentBus } from './createOfflineAdjustmentBusChain';

/** Route one chain: source → first bus → … → last bus → destination (live `AdjustmentLayerRuntime.wireChain`). */
export function wireAdjustmentBusChain(
    source: AudioNode,
    buses: readonly OfflineAdjustmentBus[],
    destination: AudioNode
): void {
    if (buses.length === 0) {
        source.connect(destination);
        return;
    }
    source.connect(buses[0]!.inputNode);
    for (let index = 0; index < buses.length; index++) {
        const next = buses[index + 1];
        if (next) {
            buses[index]!.outputNode.connect(next.inputNode);
        } else {
            buses[index]!.outputNode.connect(destination);
        }
    }
}
