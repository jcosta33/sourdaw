/**
 * AudioWorklet processor-side globals. TypeScript's DOM lib models the
 * consumer side (AudioWorkletNode) but not the producer side that runs
 * inside AudioWorkletGlobalScope. These declarations make processor files
 * type-checkable without @ts-nocheck.
 */

declare abstract class AudioWorkletProcessor {
    readonly port: MessagePort;
    abstract process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters?: Record<string, Float32Array>
    ): boolean;
}

declare function registerProcessor(name: string, processor: new (...args: unknown[]) => AudioWorkletProcessor): void;

/** Current sample rate of the AudioWorkletGlobalScope, in Hz. */
declare const sampleRate: number;

/** Monotonically increasing sample frame counter for the AudioWorkletGlobalScope. */
declare const currentFrame: number;
