/**
 * Latest Faust bargraph ("out-param") readings per live device instance.
 *
 * The vendored @grame/faustwasm already carries the whole audio-side path: the
 * worklet processor installs an output-param handler on itself and posts one
 * `{type: "out-param", path, value}` message per bargraph, and
 * `FaustBaseWebAudioDsp.updateOutputs` fires only every 6th render block — its
 * own control-rate coalescing, ≈62 ticks/s per bargraph at 48 kHz / 128-frame
 * blocks, never per sample. On the main thread, `FaustAudioWorkletNode`
 * dispatches those messages to whatever handler `setOutputParamHandler`
 * received. That main-thread handler is this module's only writer.
 *
 * Pull model, matching the engine's other meter reads (`getTrackAnalyser` +
 * `TrackLevelIndicator`): writers store the latest value, the UI reads at
 * animation rate. No React store, so a meter tick never re-renders anything.
 *
 * Readings are keyed by device instance id and by the bargraph address's last
 * path segment — the same bare-name convention `buildParamAddressCache` uses
 * for inputs — so callers address a reading by the descriptor parameter id
 * ("momentary", "short_term").
 */

/**
 * The vendored main-thread Faust node's bargraph-read surface. The node is an
 * AudioWorkletNode; `setOutputParamHandler` is the optional vendor member, so
 * a plain AudioNode stays assignable (the bridge no-ops without it).
 */
type FaustMeteredNode = AudioNode & {
    setOutputParamHandler?: (handler: ((path: string, value: number) => void) | null) => void;
};

const readingsByDevice = new Map<string, Map<string, number>>();

export function publishFaustMeterReading(deviceId: string, path: string, value: number): void {
    const bareName = path.split('/').pop();
    if (!bareName) {
        return;
    }
    let deviceReadings = readingsByDevice.get(deviceId);
    if (!deviceReadings) {
        deviceReadings = new Map<string, number>();
        readingsByDevice.set(deviceId, deviceReadings);
    }
    deviceReadings.set(bareName, value);
}

/**
 * `null` means "no reading yet" — the device is still loading or carries no
 * bargraph under that name — which is distinct from a real `-70` silence floor.
 */
export function readFaustMeterReading(deviceId: string, paramId: string): number | null {
    return readingsByDevice.get(deviceId)?.get(paramId) ?? null;
}

/** Drop a device's readings outright (teardown, or spec isolation). */
export function clearFaustMeterReadings(deviceId: string): void {
    readingsByDevice.delete(deviceId);
}

/** Route a live Faust node's bargraph posts into this device's readings. */
export function attachFaustMeterBridge(deviceId: string, node: FaustMeteredNode | undefined): void {
    node?.setOutputParamHandler?.((path, value) => publishFaustMeterReading(deviceId, path, value));
}

/**
 * Detach on teardown so a node that outlives its device (the worklet processor
 * keeps posting until destroyed) cannot resurrect readings for a removed or
 * re-added device id. A no-op for nodes without the vendor surface.
 */
export function detachFaustMeterBridge(deviceId: string, node: FaustMeteredNode | undefined): void {
    node?.setOutputParamHandler?.(null);
    readingsByDevice.delete(deviceId);
}
