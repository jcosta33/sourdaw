/**
 * The beat-to-seconds projection a flat-tempo case hands the scheduler.
 *
 * The repository owns no tempo integrator: the render use case injects the one
 * Transport integrates live playback with. A case with no tempo map states the
 * flat tempo it rides here; a case about ramps or steps is driven from the use
 * case that owns the integrator.
 */
export function constantTempoProjector(tempoBpm: number): (beat: number) => number {
    return (beat) => (beat / tempoBpm) * 60;
}
