import { MIXER_AUTOMATION_PARAMETER_IDS } from './constants';

/**
 * Whether an automation lane drives this track's own fader or panner. A render that keeps the
 * target's mixer live leaves these lanes out of the print: live keeps driving those very nodes
 * after the freeze, so baking them doubles them.
 */
export function drivesTrackMixer(lane: { trackId: string; parameterId: string }, trackId: string): boolean {
    return (
        lane.trackId === trackId &&
        MIXER_AUTOMATION_PARAMETER_IDS.some((parameterId) => parameterId === lane.parameterId)
    );
}
