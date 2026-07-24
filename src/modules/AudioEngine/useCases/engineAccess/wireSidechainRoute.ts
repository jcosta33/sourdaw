import { audioEngine } from '../../repositories/createWebAudioEngine';

import { refreshSidechainAlignment } from './refreshSidechainAlignment';

// ─── Sidechain operations ──────────────────────────────────────────────────────

export function wireSidechainRoute(sourceTrackId: string, targetTrackId: string, targetDeviceId: string): void {
    audioEngine.wireSidechainRoute(sourceTrackId, targetTrackId, targetDeviceId);
    // FX-5 — a freshly wired route starts with a zero-length alignment line;
    // resolve it immediately so the key is aligned from the first block rather
    // than only once the transport starts ticking.
    refreshSidechainAlignment();
}
