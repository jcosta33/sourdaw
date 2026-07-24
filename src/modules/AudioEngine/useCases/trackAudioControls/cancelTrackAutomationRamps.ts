import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * RT-5: cancel pending live-automation ramps on every track's fader gain and
 * pan, holding each at its current value. Called on transport stop so a ramp
 * scheduled toward a compensated future time cannot land after playback ends.
 */
export function cancelTrackAutomationRamps(): void {
    audioEngine.cancelTrackAutomationRamps();
}
