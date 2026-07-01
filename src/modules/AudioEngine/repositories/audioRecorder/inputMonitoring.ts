import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { audioEngine } from '../createWebAudioEngine';

type InputMonitoringSession = {
    monitorStream: MediaStream | null;
    monitorSource: MediaStreamAudioSourceNode | null;
};

const session = createHmrPersistentState<InputMonitoringSession>('audioEngine.inputMonitoring', () => ({
    monitorStream: null,
    monitorSource: null,
}));

export async function startInputMonitoring(trackId: string, inputId: string | null = null): Promise<boolean> {
    try {
        if (!session.monitorSource) {
            const audioConstraints: MediaTrackConstraints = {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            };
            if (inputId) {
                audioConstraints.deviceId = { exact: inputId };
            }
            session.monitorStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints,
            });
            const ctx = audioEngine.context;
            session.monitorSource = ctx.createMediaStreamSource(session.monitorStream);
        }

        // Always ensure connection to the latest track strip (handles HMR replacement of strips)
        const strip = audioEngine.ensureTrackStrip(trackId);
        session.monitorSource.connect(strip.gainNode);
        return true;
    } catch {
        return false;
    }
}

export function stopInputMonitoring(): void {
    if (session.monitorSource) {
        session.monitorSource.disconnect();
        session.monitorSource = null;
    }
    if (session.monitorStream) {
        for (const time of session.monitorStream.getTracks()) {
            time.stop();
        }
        session.monitorStream = null;
    }
}
