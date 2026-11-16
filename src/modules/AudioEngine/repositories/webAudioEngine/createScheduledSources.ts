export type ScheduledSources = {
    /** The live tracking list: sources stay in it until they end or {@link stopAll} empties it. */
    nodes(): AudioScheduledSourceNode[];
    scheduleOscillator(frequency: number, startTime: number, duration: number, gain?: number): void;
    scheduleClick(time: number, accent: boolean, volume?: number): void;
    register(node: AudioScheduledSourceNode): void;
    /** Stops every tracked source at the context's current time and empties the list. */
    stopAll(): void;
};

export type ScheduledSourcesPorts = Readonly<{
    readContext: () => AudioContext;
    /** Destination of every oscillator envelope. */
    readMasterGain: () => GainNode;
    assertActive: () => void;
    /** Read per call: no source is created or tracked on the fallback graph. */
    isFallback: () => boolean;
}>;

export function createScheduledSources({
    readContext,
    readMasterGain,
    assertActive,
    isFallback,
}: ScheduledSourcesPorts): ScheduledSources {
    const scheduledNodes: AudioScheduledSourceNode[] = [];

    function untrack(node: AudioScheduledSourceNode): void {
        const index = scheduledNodes.indexOf(node);
        if (index >= 0) {
            scheduledNodes.splice(index, 1);
        }
    }

    function scheduleOscillator(frequency: number, startTime: number, duration: number, gain = 0.3): void {
        assertActive();
        if (isFallback()) {
            return;
        }
        const context = readContext();
        const osc = context.createOscillator();
        const env = context.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        env.gain.setValueAtTime(0, startTime);
        env.gain.linearRampToValueAtTime(gain, startTime + 0.005);
        env.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        osc.connect(env);
        env.connect(readMasterGain());
        osc.start(startTime);
        osc.stop(startTime + duration);
        scheduledNodes.push(osc);
        osc.onended = () => {
            untrack(osc);
            env.disconnect();
        };
    }

    function scheduleClick(time: number, accent: boolean, volume = 1): void {
        const freq = accent ? 1500 : 1000;
        const dur = accent ? 0.04 : 0.03;
        const baseVol = accent ? 0.4 : 0.25;
        scheduleOscillator(freq, time, dur, baseVol * volume);
    }

    function register(node: AudioScheduledSourceNode): void {
        assertActive();
        if (isFallback()) {
            return;
        }
        // Built-in synth and kit voices are bare oscillators written straight
        // into the strip; the scheduled path discarded the handle, so a stop or
        // a panic could not silence them and they rang on for the rest of their
        // programmed duration (audit MD-6). Tracking them here puts them under
        // the same `stopAll` sweep as the metronome.
        scheduledNodes.push(node);
        node.addEventListener('ended', () => untrack(node));
    }

    function stopAll(): void {
        const now = readContext().currentTime;
        for (const node of [...scheduledNodes]) {
            try {
                node.stop(now);
            } catch {
                // ignore
            }
        }
        scheduledNodes.length = 0;
    }

    return {
        nodes: () => scheduledNodes,
        scheduleOscillator,
        scheduleClick,
        register,
        stopAll,
    };
}
