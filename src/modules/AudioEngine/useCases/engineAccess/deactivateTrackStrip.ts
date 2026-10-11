import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * Tears down the channel strip of a track that stays in the project without a
 * live strip (a folder whose last Toaster was removed). Its remaining devices
 * stay in the project, so unlike `removeTrackStrip` it announces no removal.
 */
export function deactivateTrackStrip(trackId: string): void {
    audioEngine.deactivateTrackStrip(trackId);
}
