import { audioEngine } from '../createWebAudioEngine';

import { attachCrumbsRecordFeedToMonitorSource } from './crumbsRecordFeed';
import { inputMonitoringSession } from './inputMonitoringSession';

export async function startInputMonitoring(trackId: string, inputId: string | null = null): Promise<boolean> {
    try {
        if (!inputMonitoringSession.monitorSource) {
            const audioConstraints: MediaTrackConstraints = {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            };
            if (inputId) {
                audioConstraints.deviceId = { exact: inputId };
            }
            inputMonitoringSession.monitorStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints,
            });
            const ctx = audioEngine.context;
            inputMonitoringSession.monitorSource = ctx.createMediaStreamSource(inputMonitoringSession.monitorStream);
        }

        // Always ensure connection to the latest track strip (handles HMR replacement of strips)
        const strip = audioEngine.ensureTrackStrip(trackId);
        inputMonitoringSession.monitorSource.connect(strip.gainNode);
        // A crumbs recording armed before monitoring existed has a tap with
        // nothing attached: the monitored input bus is its only source, so it
        // connects here, when that bus first exists.
        attachCrumbsRecordFeedToMonitorSource();
        return true;
    } catch {
        return false;
    }
}
