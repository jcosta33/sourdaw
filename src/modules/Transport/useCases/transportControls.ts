import { transportStore } from "../stores/transportStore";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";
import { startPlayheadScheduler, stopPlayheadScheduler } from "./playheadScheduler";

export const togglePlayback = (): void => {
    const state = transportStore.value;
    if (!state) return;

    if (state.isPlaying) {
        stopPlayback();
    } else {
        startPlayback();
    }
};

export const startPlayback = (): void => {
    const state = transportStore.value;
    if (!state) return;

    void audioEngine.resume();
    transportStore.set({ ...state, isPlaying: true });
    startPlayheadScheduler();
};

export const stopPlayback = (): void => {
    const state = transportStore.value;
    if (!state) return;

    stopPlayheadScheduler();
    void audioEngine.suspend();
    transportStore.set({ ...state, isPlaying: false, playheadPosition: 0 });
};

export const toggleLoop = (): void => {
    const state = transportStore.value;
    if (!state) return;
    transportStore.set({ ...state, isLooping: !state.isLooping });
};

export const toggleMetronome = (): void => {
    const state = transportStore.value;
    if (!state) return;
    transportStore.set({ ...state, metronomeEnabled: !state.metronomeEnabled });
};

export const setLoopRegion = (startBeat: number, endBeat: number): void => {
    const state = transportStore.value;
    if (!state) return;
    transportStore.set({ ...state, loopStart: startBeat, loopEnd: endBeat });
};

export const toggleRecording = (): void => {
    const state = transportStore.value;
    if (!state) return;
    transportStore.set({ ...state, isRecording: !state.isRecording });
    if (!state.isRecording && !state.isPlaying) {
        startPlayback();
    }
};
