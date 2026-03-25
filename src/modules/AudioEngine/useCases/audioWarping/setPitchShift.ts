import { audioWarpStore, DEFAULT_WARP_SETTINGS } from '#/modules/AudioEngine/stores/audioWarp';

export function setPitchShift(clipId: string, semitones: number): void {
    const state = audioWarpStore.value;
    if (!state) {
        return;
    }
    const settings = state.clipSettings.get(clipId) ?? { ...DEFAULT_WARP_SETTINGS };
    const newMap = new Map(state.clipSettings);
    newMap.set(clipId, { ...settings, pitchShiftSemitones: Math.max(-24, Math.min(24, semitones)) });
    audioWarpStore.set({ ...state, clipSettings: newMap });
}
