/**
 * The two nodes one frame-addressed device parameter writes together.
 *
 * A model rather than a repository type because the resolver lives in
 * `services/deviceResolution.ts`, which the module boundary forbids from
 * importing `repositories/`: the binding that carries the pair, the resolver
 * that finds it, and the write that applies it all name this one type.
 *
 * Neither node is an `AudioParam`. The value is a rebuilt `WaveShaper` curve,
 * so it can only be applied at a sample frame rather than scheduled on a param.
 */
export type OfflineCurveWriteTargets = {
    readonly ceiling: GainNode;
    readonly clipper: WaveShaperNode;
};
