/**
 * The tail a loaded hosted plugin instance adds to a render, as the estimator's
 * declaration shape (#4592).
 *
 * A hosted plugin declares no tail through a descriptor — every hosted device
 * spells the one type `external-plugin` — so its tail is the instance's own
 * report, recorded by PluginHost from the load and from `plugin-tail-changed`.
 * The report is in frames of the instance's activation rate. An instance the
 * native render can print is attached to the running engine, and the native
 * host refuses to attach one activated at any other rate
 * (`register_engine_plugin`'s rate guard), so the engine's own output rate is
 * that activation rate exactly.
 *
 * Both formats reserve the top of the range for a tail that never ends — CLAP
 * any value at or above `INT32_MAX`, VST3's `kInfiniteTail` above it — and
 * that tail is declared `unbounded`, so the estimator reserves its own ceiling
 * on any unbounded tail, `MAX_AUTO_TAIL_SECONDS`, and reports it clamped. So is
 * a tail whose rate this process cannot read: over-reserving costs trailing
 * near-silence, under-reserving is an audible cut (the estimator's own bias).
 */

import { externalPluginTailStore } from '#/modules/PluginHost/stores';

import { isExistingEngineReading } from '../../models/EngineRtDiagnostics';
import { type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';
import { engineRtDiagnosticsStore } from '../../stores/engineRtDiagnosticsStore';

/** The lowest tail either plugin format reads as one that never ends (`INT32_MAX`). */
export const UNENDING_PLUGIN_TAIL_SAMPLES = 2_147_483_647;

/** Seconds of tail, or `null` when the report bounds nothing the render can honour. */
function hostedPluginTailSeconds(input: { tailSamples: number; activationSampleRate: number | null }): number | null {
    const { tailSamples, activationSampleRate } = input;
    if (tailSamples >= UNENDING_PLUGIN_TAIL_SAMPLES || activationSampleRate === null || activationSampleRate <= 0) {
        return null;
    }
    return tailSamples / activationSampleRate;
}

function runningEngineSampleRate(): number | null {
    const latest = engineRtDiagnosticsStore.value?.latest ?? null;
    return isExistingEngineReading(latest) ? latest.sampleRate : null;
}

/** The tail one hosted instance declares, or `undefined` when it reported none. */
export function readHostedPluginTail(externalInstanceId: string): TailDeclarationLike | undefined {
    const tailSamples = externalPluginTailStore.value?.tailSamplesByInstanceId[externalInstanceId];
    if (tailSamples === undefined || !Number.isFinite(tailSamples) || tailSamples <= 0) {
        return undefined;
    }
    const seconds = hostedPluginTailSeconds({ tailSamples, activationSampleRate: runningEngineSampleRate() });
    return seconds === null ? { kind: 'unbounded' } : { kind: 'fixed', seconds };
}
