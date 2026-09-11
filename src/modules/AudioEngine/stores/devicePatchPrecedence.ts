/**
 * The replay laws a web host applies when it rebuilds a device from its
 * persisted `parameterValues` record.
 *
 * A record is an unordered map whose insertion order is an accident of the
 * writes that built it (`persistDeviceParam` spreads and appends), yet some
 * devices carry pairs of names that write one engine slot, or macros that
 * rewrite other entries the same record carries. The native engine resolves
 * this with a per-body ordering law (`*_PATCH_PRECEDENCE` and
 * `GLUTEN_MACRO_KEYS`, `crates/daw-engine/src/scheduler.rs`): the law's keys
 * land first, in the listed order, and the remaining entries follow in record
 * order. `orderDevicePatchEntries` mirrors that law for the web side so a
 * strip rebuild and an offline render resolve a record the way the native
 * body does, whatever order the record happens to be drawn in.
 */
const DEVICE_PATCH_PRECEDENCE: Readonly<Record<string, readonly string[]>> = {
    // `style` and `algorithm` both write Crust's single algorithm slot; the
    // three-way style pick leads so the exact eight-way pick lands last
    // (CRUST_PATCH_PRECEDENCE).
    crust: ['style'],
    // `topology`, `style` and `amount` each rewrite other Gluten entries the
    // record may carry (threshold, ratio, attack, ...), so all three lead in
    // descriptor order and the specific entries land last
    // (GLUTEN_MACRO_KEYS).
    gluten: ['topology', 'style', 'amount'],
    // `neuralEnabled` and `engineMode` both write NeuralCapture's single
    // engine_mode field; the boolean simplification leads so the exact
    // three-way pick lands last (GRINDER_PATCH_PRECEDENCE).
    grinder: ['neuralEnabled'],
};

/**
 * One device's record as the entries to replay: the device's precedence keys
 * first, in the law's order, then every remaining entry in record order.
 * Devices without a law replay in record order unchanged.
 */
export function orderDevicePatchEntries<Value>(
    deviceType: string,
    parameterValues: Readonly<Record<string, Value>>
): Array<[string, Value]> {
    const precedence = DEVICE_PATCH_PRECEDENCE[deviceType];
    const entries = Object.entries(parameterValues);
    if (!precedence || precedence.length === 0) {
        return entries;
    }

    const leadingKeys = new Set(precedence);
    const leading: Array<[string, Value]> = [];
    for (const key of precedence) {
        const entry = entries.find(([candidate]) => candidate === key);
        if (entry) {
            leading.push(entry);
        }
    }
    return [...leading, ...entries.filter(([key]) => !leadingKeys.has(key))];
}
