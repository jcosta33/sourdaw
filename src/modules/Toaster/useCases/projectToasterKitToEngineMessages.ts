import { type ToasterKit } from '../models/ToasterKit';

import { TOASTER_ENGINE_MAP } from './loadToasterKit';

/**
 * A single control write addressed to a Toaster engine, in the shape `ToasterNode`
 * already posts for `setParam` and `setPadParam`.
 */
export type ToasterEngineMessage =
    { type: 'param'; name: string; value: number } | { type: 'padParam'; pad: number; name: string; value: number };

export type ProjectToasterKitToEngineMessagesInput = {
    kit: ToasterKit;
};

/**
 * Project a kit into the full set of control writes an engine needs to *be* that
 * kit.
 *
 * This is a pure function of kit state, deliberately: a Toaster's audible identity
 * is not carried by `device.parameterValues`, it is pushed after construction. The
 * live path pushed it from a store subscriber, so only a runtime with a
 * subscription lifecycle ever received it — and the offline renderer has none.
 * Exports therefore rendered the engine's built-in defaults instead of the
 * project's kit: every pad wrong in engine type, tuning, decay, tone, drive,
 * filtering and sends.
 *
 * Both runtimes need the same answer to "what does this kit send?" but differ in
 * when they ask. The subscriber re-asks on every change; an offline render asks
 * once, at construction. Keeping the projection pure is what lets the offline path
 * reuse it without acquiring a subscription or a store handle it has no business
 * owning.
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
        // `TOASTER_ENGINE_MAP` is a total `Record<DrumEngineType, number>`, so there
        // is no missing-key case to defend against; a `?? 0` here would silently
        // read as "generic kick" if the map ever stopped being total.
        messages.push({
            type: 'padParam',
            pad: index,
            name: 'engine_type',
            value: TOASTER_ENGINE_MAP[pad.engineType],
        });

        // The open/closed hi-hat pair share one engine index and are distinguished
        // by this flag, so it has to travel with the engine type rather than being
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

        // Engine-specific voicing (snappy, noise_level, base_freq, …). `Pad::set_param`
        // ignores a name it does not know, so an entry left over from a different
        // engine is inert rather than harmful.
        for (const [name, value] of Object.entries(pad.engineParams)) {
            messages.push({ type: 'padParam', pad: index, name, value });
        }
    }

    return messages;
}
