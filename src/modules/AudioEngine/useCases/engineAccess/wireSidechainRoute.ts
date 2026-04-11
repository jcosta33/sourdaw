import { audioEngine } from '../../repositories/createWebAudioEngine';

// ─── Sidechain operations ──────────────────────────────────────────────────────

export function wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
    audioEngine.wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
}