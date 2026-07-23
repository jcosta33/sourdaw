import { audioEngine } from '../../repositories/createWebAudioEngine';

export function setTrackOutput(
    trackId: string,
    outputId: string,
    padBinding?: { toasterParentTrackId: string; padIndex: number }
): void {
    audioEngine.setTrackOutput(trackId, outputId, padBinding);
}
