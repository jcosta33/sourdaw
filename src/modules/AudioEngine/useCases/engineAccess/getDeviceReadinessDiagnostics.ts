import { audioEngine } from '../../repositories/createWebAudioEngine';

export function getDeviceReadinessDiagnostics() {
    return audioEngine.getDeviceReadinessDiagnostics();
}
