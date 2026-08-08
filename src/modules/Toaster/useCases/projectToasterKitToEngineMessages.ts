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

        // Stated for both values, never omitted. Saying nothing on `true` is what
        // let a muted pad keep sounding after a device reload, a preset load or an
        // offline render; saying nothing on `false` would be the mirror defect,
        // because the engine keeps pad state across kit loads, so a pad muted under
        // the outgoing kit would stay muted under the incoming one.
        messages.push({ type: 'padParam', pad: index, name: 'muted', value: pad.muted ? 1 : 0 });

        // Stated for both values for the same reason as `muted`: the engine keeps
        // pad state across kit loads, so an omitted `false` would leave a pad
        // soloed under the kit that replaced the one it was soloed in — and with
        // solo that leaks further than mute does, because one stale soloed pad
        // silences every other pad on the device.
        messages.push({ type: 'padParam', pad: index, name: 'soloed', value: pad.soloed ? 1 : 0 });

        // The engine's choke handling has always been live (`Pad::choke_group`
        // is read at every note-on); until this message existed nothing ever
        // told it what the kit's grouping was, so the engine fell back to a
        // construction default keyed on pad index and the "C1" badge the pad
        // grid draws from `pad.chokeGroup` described a grouping the audio did
        // not have. Sent for group 0 too — "this pad chokes nothing" is a
        // statement the engine has to hear to unset a previous kit's grouping.
        messages.push({ type: 'padParam', pad: index, name: 'choke_group', value: pad.chokeGroup });
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
