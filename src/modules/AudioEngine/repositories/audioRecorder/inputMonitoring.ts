import { audioEngine } from '../createWebAudioEngine';
import { getSelectedInputId } from '../../useCases/audioDeviceSelection/getSelectedInputId';

let monitorStream: MediaStream | null = null;
let monitorSource: MediaStreamAudioSourceNode | null = null;

export async function startInputMonitoring(trackId: string, inputId?: string | null): Promise<boolean> {
    if (monitorSource) {
        return true;
    }
    try {
        const selectedInputId = inputId ?? getSelectedInputId();
        const audioConstraints: MediaTrackConstraints = {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
        };
        if (selectedInputId) {
            audioConstraints.deviceId = { exact: selectedInputId };
        }
        monitorStream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
        });
        const ctx = audioEngine.context;
        monitorSource = ctx.createMediaStreamSource(monitorStream);
        const strip = audioEngine.ensureTrackStrip(trackId);
        monitorSource.connect(strip.gainNode);
        return true;
    } catch {
        return false;
    }
}

export function stopInputMonitoring(): void {
    if (monitorSource) {
        monitorSource.disconnect();
        monitorSource = null;
    }
    if (monitorStream) {
        for (const t of monitorStream.getTracks()) {
            t.stop();
        }
        monitorStream = null;
    }
}
