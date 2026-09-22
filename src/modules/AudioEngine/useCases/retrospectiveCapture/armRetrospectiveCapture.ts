import { armRetrospectiveCapture as armRetrospectiveCaptureRepo } from '../../repositories/retrospectiveCapture/armRetrospectiveCapture';

/** Stereo input is the conventional DAW capture width for this ring. */
const DEFAULT_RETROSPECTIVE_CHANNELS = 2;

/**
 * Arm the engine's retrospective ring for one project track strip.
 *
 * Fire-and-forget from PunchRecording: a declined arm leaves punch mode
 * enabled in the store without inventing a second ring on the web side.
 */
export function armRetrospectiveCapture(trackId: string): void {
    void armRetrospectiveCaptureRepo(trackId, DEFAULT_RETROSPECTIVE_CHANNELS);
}
