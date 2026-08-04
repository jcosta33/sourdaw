import { type ToasterKit } from '../models/ToasterKit';

import { TOASTER_ENGINE_MAP } from './toasterEngineMap';

/**
 * A single control write addressed to a Toaster engine, in the shape `ToasterNode`
 * already posts for `setParam` and `setPadParam`.
 *
 * `value` holds for every kit that type-checks: each number is read straight off
 * `ToasterKit`, and the one lookup involved is total over its key union. Malformed
 * data from another build is caught by the finite filter this function exits
 * through, so nothing downstream has to re-check.
 */
export type ToasterEngineMessage =
    { type: 'param'; name: string; value: number } | { type: 'padParam'; pad: number; name: string; value: number };

export type ProjectToasterKitToEngineMessagesInput = {
    kit: ToasterKit;
};

/**
 * Project a kit into the control writes an engine needs to *be* that kit.
 *
 * A Toaster's audible identity is not carried by `device.parameterValues` — that
 * holds only the four automatable kit-level numbers. Engine type, tuning, decay,
 * tone, drive, filtering and sends are pushed to the engine after construction,
 * and this is the single answer to "what does this kit send?" for every caller
 * that has to do the pushing: the live device-load subscriber, the preset loader,
 * and the offline render.
 *
 * They differ only in *when* they ask. The subscriber asks on every device load,
 * the preset loader on every preset, the offline render once at construction.
 * Keeping the projection pure is what lets the offline path reuse it without
 * acquiring a subscription or a store handle it has no business owning.
 *
 * `engine_type` is always sent before `engineParams`. The DSP treats that write as
 * the reset boundary for engine-specific pad storage, then these explicit kit
 * overrides are applied after the common controls. That ordering prevents a pad
 * from inheriting voicing from its previous engine while keeping initial load,
 * runtime reload, and offline construction on one exact message contract.
 */
export function projectToasterKitToEngineMessages({
    kit,
}: ProjectToasterKitToEngineMessagesInput): ToasterEngineMessage[] {
    const messages: ToasterEngineMessage[] = [
        { type: 'param', name: 'master_gain', value: kit.masterGain },
        { type: 'param', name: 'reverb_mix', value: kit.reverbMix },
        { type: 'param', name: 'reverb_decay', value: kit.reverbDecay },
        { type: 'param', name: 'delay_time', value: kit.delayTime },
        { type: 'param', name: 'delay_feedback', value: kit.delayFeedback },
        { type: 'param', name: 'delay_mix', value: kit.delayMix },
        { type: 'param', name: 'lofi_bits', value: kit.lofiBits },
        { type: 'param', name: 'lofi_rate', value: kit.lofiRate },
        { type: 'param', name: 'lofi_mix', value: kit.lofiMix },
    ];

    for (let index = 0; index < kit.pads.length; index++) {
        const pad = kit.pads[index]!;

        // `TOASTER_ENGINE_MAP` is `Record<DrumEngineType, number>` — total over the
        // union — so this lookup cannot miss for data that type-checks. There is
        // deliberately no second guard here: the previous `?? 0` silently asserted
        // "generic kick" for a pad whose engine could not be read, and a
        // `!== undefined` check would be a condition the type says can never fire.
        // A project written by a different build can still carry an engine name
        // outside the union; that lands as `undefined`, which the finite filter at
        // the end of this function drops. One net, at the exit, rather than two.
        messages.push({ type: 'padParam', pad: index, name: 'engine_type', value: TOASTER_ENGINE_MAP[pad.engineType] });

        // The open/closed hi-hat pair share one engine index and are distinguished
        // by this flag, so it travels with the engine type rather than being
        // inferred later.
        if (pad.engineType === 'hihat-open') {
            messages.push({ type: 'padParam', pad: index, name: 'open', value: 1 });
        }
        if (pad.engineType === 'hihat-closed') {
            messages.push({ type: 'padParam', pad: index, name: 'open', value: 0 });
        }

        messages.push({ type: 'padParam', pad: index, name: 'volume', value: pad.volume });
        messages.push({ type: 'padParam', pad: index, name: 'pan', value: pad.pan });
        messages.push({ type: 'padParam', pad: index, name: 'tune', value: pad.tune });
        messages.push({ type: 'padParam', pad: index, name: 'decay', value: pad.decay });
        messages.push({ type: 'padParam', pad: index, name: 'tone', value: pad.tone });
        messages.push({ type: 'padParam', pad: index, name: 'drive', value: pad.drive });
        messages.push({ type: 'padParam', pad: index, name: 'filter_cutoff', value: pad.filterCutoff });
        messages.push({ type: 'padParam', pad: index, name: 'filter_resonance', value: pad.filterResonance });
        messages.push({ type: 'padParam', pad: index, name: 'send_reverb', value: pad.sendReverb });
        messages.push({ type: 'padParam', pad: index, name: 'send_delay', value: pad.sendDelay });

        for (const [name, value] of Object.entries(pad.engineParams)) {
            messages.push({ type: 'padParam', pad: index, name, value });
        }
    }

    // `ToasterNode.setParam`/`setPadParam` both refuse a non-finite value, so the
    // live callers were protected by the wrapper they write through. The offline
    // caller posts these at the worklet port directly and never touches that
    // wrapper. Filtering here is what keeps the two paths posting the same thing:
    // without it, a NaN a live session silently swallows would reach the DSP on
    // export only, and the export would stop matching the session.
    return messages.filter((message) => Number.isFinite(message.value));
}
