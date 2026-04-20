import { audioEngine } from '../../repositories/createWebAudioEngine';

// ─── Bus operations ────────────────────────────────────────────────────────────

export function ensureBusStrip(busId: string): void {
    audioEngine.ensureBusStrip(busId);
}
