/**
 * The constant processing delay a built-in Faust module imposes, in ms.
 *
 * A Faust module is compiled from a fixed `.dsp` source, so any delay line in
 * its signal path is a property of that source and not of the runtime. What is
 * declared here is the delay the module imposes *for every setting of every
 * control* — the engine reports it once, at create, and the value stays true
 * for the life of the device.
 *
 * That "for every setting" is a design constraint on the DSP, not a
 * simplification of it. `getCompensationDelay` is read at the moment each clip,
 * note and automation point is scheduled, so a latency that moved mid-session
 * would re-plan only the material scheduled after the move, would never be
 * re-reported when the control is driven by an automation lane (which writes
 * the AudioParam directly), and would strand any already-frozen track, whose
 * compensation `freezeTrack` bakes in at freeze time. A module that wants a
 * variable look-ahead therefore spends it on its detector and keeps its own
 * output delay pinned at the maximum — see `dsp/brick-wall-limiter.dsp`.
 *
 * A module absent from this table imposes no delay of its own, which is the
 * case for every built-in that carries no delay line ahead of its output.
 */
const FAUST_MODULE_LATENCY_MS: Readonly<Record<string, number>> = {
    // `MAX_LOOKAHEAD_S = 0.01` in dsp/brick-wall-limiter.dsp. The DSP delays
    // its output by that whole amount at every `lookahead` setting.
    // `faustLookaheadLatency.spec.ts` reads the DSP source and holds the two
    // numbers together, so moving one without the other reds.
    'faust-brick-wall-limiter': 10,
};

export function getFaustModuleLatencyMs(moduleId: string): number {
    return FAUST_MODULE_LATENCY_MS[moduleId] ?? 0;
}
