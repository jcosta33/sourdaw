import { transportStore } from "../stores/transportStore";
import { audioEngine } from "#/modules/AudioEngine/repositories/audioEngineInstance";

let rafId = 0;
let startTime = 0;
let startPosition = 0;

export const startPlayheadScheduler = (): void => {
    const state = transportStore.value;
    if (!state) return;

    const ctx = audioEngine.context;
    startTime = ctx.currentTime;
    startPosition = state.playheadPosition;

    const tick = () => {
        const current = transportStore.value;
        if (!current?.isPlaying) return;

        const elapsed = ctx.currentTime - startTime;
        const beatsPerSecond = current.tempo / 60;
        const newPosition = startPosition + elapsed * beatsPerSecond;

        if (current.isLooping && current.loopEnd > current.loopStart && newPosition >= current.loopEnd) {
            const loopLength = current.loopEnd - current.loopStart;
            const wrapped = current.loopStart + ((newPosition - current.loopStart) % loopLength);
            transportStore.set({ ...current, playheadPosition: wrapped });
            startTime = ctx.currentTime;
            startPosition = wrapped;
        } else {
            transportStore.set({ ...current, playheadPosition: newPosition });
        }

        rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
};

export const stopPlayheadScheduler = (): void => {
    cancelAnimationFrame(rafId);
    rafId = 0;
};
