import { audioEngine } from '../../repositories/createWebAudioEngine';
import { clearAllReportedLatency } from '../latencyCompensation/compensation/externalLatencyRegistry';

export function resetAudioGraph(): void {
    audioEngine.resetGraph();
    clearAllReportedLatency();
}
