import type { AudioEngine, AudioEngineState } from "../models/AudioEngineState";

export const createWebAudioEngine = (): AudioEngine => {
    const context = new AudioContext({ latencyHint: "interactive" });
    const masterGainNode = context.createGain();
    masterGainNode.connect(context.destination);
    masterGainNode.gain.value = 0.8;

    let workletReady = false;

    const initialize = async (): Promise<void> => {
        try {
            await context.audioWorklet.addModule("/audio/worklets/gain-processor.js");
            await context.audioWorklet.addModule("/audio/worklets/meter-processor.js");
            workletReady = true;
        } catch (e) {
            console.warn("AudioWorklet modules failed to load, continuing without worklets:", e);
        }

        if (context.state === "suspended") {
            await context.resume();
        }
    };

    const resume = async (): Promise<void> => {
        if (context.state === "suspended") {
            await context.resume();
        }
    };

    const suspend = async (): Promise<void> => {
        if (context.state === "running") {
            await context.suspend();
        }
    };

    const setMasterGain = (value: number): void => {
        const clamped = Math.max(0, Math.min(1, value));
        masterGainNode.gain.setValueAtTime(clamped, context.currentTime);
    };

    const getMasterGain = (): number => {
        return masterGainNode.gain.value;
    };

    const getState = (): AudioEngineState => ({
        isReady: context.state === "running" || workletReady,
        sampleRate: context.sampleRate,
        state: context.state,
        masterGain: masterGainNode.gain.value,
    });

    const dispose = (): void => {
        masterGainNode.disconnect();
        void context.close();
    };

    return {
        context,
        masterGainNode,
        initialize,
        resume,
        suspend,
        setMasterGain,
        getMasterGain,
        getState,
        dispose,
    };
};
