/**
 * The engine's own name for a pad field a panel writes.
 *
 * `setToasterPadParam` and `setPadParamImmediate` address a pad by its
 * `PadState` key, and the worklet translates at its own message door
 * (`PAD_PARAM_MAP`, `AudioEngine/services/toasterProcessor.ts`). The native
 * body has no such door, so a write leaving for the engine has to arrive
 * already spelled the way the kit projection spells it
 * (`projectToasterKitToEngineMessages`) — `sendReverb` reaching a pad as
 * `sendReverb` is a control the pad engine has no arm for and silently drops.
 *
 * A name with no entry passes through, which is what carries a field already
 * spelled for the engine (`engine_type` from a sound lock) and a pad's own
 * `engineParams` key.
 */
const PAD_FIELD_ENGINE_NAMES: Readonly<Record<string, string>> = {
    chokeGroup: 'choke_group',
    filterCutoff: 'filter_cutoff',
    filterResonance: 'filter_resonance',
    sendReverb: 'send_reverb',
    sendDelay: 'send_delay',
    engineType: 'engine_type',
    transientAttack: 'transient_attack',
    transientSustain: 'transient_sustain',
    busRoute: 'bus_route',
};

export function toasterPadEngineParamName(padField: string): string {
    return PAD_FIELD_ENGINE_NAMES[padField] ?? padField;
}
