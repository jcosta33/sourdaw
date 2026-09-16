import { audioEngine } from '../../repositories/createWebAudioEngine';
import { forgetLatchedLiveMidiControls } from '../../services/liveMidiControlLatch';
import { clearAllReportedLatency } from '../latencyCompensation/compensation/externalLatencyRegistry';

export function resetAudioGraph(): void {
    audioEngine.resetGraph();
    clearAllReportedLatency();
    // The pedal latch belongs to the project being torn down here. Track and
    // device ids persist across a save, so a position it kept would be
    // replayed onto the next project's first native body while that project's
    // own Web Audio node comes up with the pedal released.
    forgetLatchedLiveMidiControls();
}
