/**
 * The device-parameter values the live automation pass actually wrote
 * on the current tick, indexed `deviceId → parameterId → value`.
 *
 * `applyAutomation` and `applyModulationToEngine` both write the same device
 * parameters on the same tick, and modulation runs last, so modulation's write
 * is the one the DSP hears. Modulation used to rebuild its base by re-reading
 * the automation curve, which returns the *raw* value; automation writes the
 * *slewed* one. The two therefore disagreed about the same parameter within a
 * single tick, and the combined value jumped ahead of the glide automation
 * alone would have produced.
 *
 * This map is the hand-off: automation records what it applied, the scheduler
 * passes the map to `applyModulationToEngine`, and modulation adds its delta on
 * top of that instead of a value nothing ever wrote. It is transport-owned
 * scheduler state (the same pattern as `schedulerSession`), not project truth.
 *
 * Lifecycle: `applyAutomation` clears it at the top of every tick, so a reader
 * only ever sees the current tick's writes. It is cleared by emptying the inner
 * maps in place rather than dropping them, so the steady-state tick allocates
 * nothing.
 *
 * Only device parameters live here. `gain`/`pan` are not slewed (they are
 * scheduled a-rate on real AudioParams) and modulation does not target them.
 */
export const appliedAutomationBases = new Map<string, Map<string, number>>();

/** Empty every per-device map in place, keeping the maps themselves allocated. */
export function clearAppliedAutomationBases(): void {
    for (const byParameter of appliedAutomationBases.values()) {
        byParameter.clear();
    }
}
