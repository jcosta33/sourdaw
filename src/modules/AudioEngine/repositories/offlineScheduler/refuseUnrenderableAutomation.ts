/**
 * The device parameters a render cannot carry, and the actionable refusal the
 * musician reads instead of a silent drop (#4424).
 *
 * `scheduleTrackAutomation` asks each device in the chain for an offline
 * binding, and a device that answers `null` used to be skipped with a bare
 * `continue`. For most structural exemptions that is the right answer: the
 * parameter changes nothing a bounce could capture, so a project carrying the
 * lane still renders what the session plays. The limiter ceiling is not one of
 * them — live, the ceiling knob reaches the output through the clipper's
 * rebuilt WaveShaper curve, so the session's monitor follows the lane while the
 * bounce freezes the static ceiling and reports success.
 *
 * ── Silent structural exemptions, kept that way on purpose ────────────────
 *
 * Every other unbound parameter this scheduler can meet (`dist-drive`,
 * `crush-bits`, `rev-size`/`rev-decay`/`rev-damping`, and `crush-rate` when the
 * rate-decimator worklet module has not loaded) stays a silent drop for now.
 * They are the same class of gap, but making each one actionable is its own
 * slice; issue #4424 scopes the limiter ceiling alone, so this module carries
 * one row and no others.
 */
const UNRENDERABLE_AUTOMATION_REFUSALS: Readonly<Record<string, string>> = {
    'builtin-limiter:lim-ceiling':
        'The limiter ceiling cannot be automated in this render: the ceiling is applied as a clipping curve ' +
        'that only a static ceiling value rebuilds, so a rendered file would keep the saved ceiling while the ' +
        'session plays the lane. Remove the ceiling automation lane, disable it, or set a static ceiling to ' +
        'render without it.',
};

/**
 * The one-sentence reason this device parameter lane cannot be rendered, or
 * `null` when the lane may be dropped without telling the musician.
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
    return UNRENDERABLE_AUTOMATION_REFUSALS[`${input.deviceType}:${input.parameterId}`] ?? null;
}
