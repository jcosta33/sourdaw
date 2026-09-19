/**
 * The one device-parameter lane this render cannot write, and the actionable
 * refusal the musician reads instead of a silent drop.
 *
 * `scheduleTrackAutomation` asks each device in the chain for an offline
 * binding. Most parameters resolve an `AudioParam` or a segment stream; a
 * parameter with neither — the limiter ceiling, whose advertised cap is the
 * clipper's rebuilt WaveShaper curve — resolves a frame-addressed `curveWrite`
 * binding and is written at each automation frame through the offline frame
 * scheduler, which batches every call due on one quantised frame behind a single
 * `suspend` (#4437).
 *
 * That write needs the render's scheduler. The root that owns the
 * `OfflineAudioContext` creates exactly one and threads it down, but the
 * recording projection (`projectStripAutomationWrites`) runs the same lane laws
 * with no context of its own and passes none. Dropping the lane there would
 * report success with the lane's moves missing, so the render fails closed with
 * this message instead.
 *
 * `contributesAudio` is the whole of the second half: a strip whose output
 * cannot reach the print contributes silence by construction, so refusing over
 * its lanes would fail an export over audio that was never going to be in it
 * (#4376, #4424).
 */
export function unrenderableAutomationRefusal(input: {
    deviceType: string;
    parameterId: string;
    contributesAudio: boolean;
}): string | null {
    if (!input.contributesAudio) {
        return null;
    }
    return (
        `The "${input.parameterId}" automation on ${input.deviceType} cannot be rendered: the parameter has no ` +
        `AudioParam, so its cap is a clipping curve that must be written at an automation frame, and this ` +
        `render path provided no frame scheduler to write it on. Remove the lane, disable it, or set a static ` +
        `value to render without it.`
    );
}
