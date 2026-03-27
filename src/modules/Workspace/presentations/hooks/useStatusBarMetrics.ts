import { type RefObject, useEffect, useRef } from 'react';
import { getEngineState, getMasterPeakLevel } from '#/modules/AudioEngine/useCases/engineAccess';
import { animationScheduler } from '#/helpers/DOM/AnimationScheduler';

/**
 * Refs for DOM elements that StatusBar updates at 60 fps via direct mutation.
 * The hook registers an animation tick that writes to these refs every frame.
 */
export type StatusBarMetricRefs = {
    cpuBar: RefObject<HTMLDivElement | null>;
    cpuText: RefObject<HTMLSpanElement | null>;
    memContainer: RefObject<HTMLDivElement | null>;
    memText: RefObject<HTMLSpanElement | null>;
    sampleRate: RefObject<HTMLSpanElement | null>;
    latency: RefObject<HTMLSpanElement | null>;
    masterLevelBar: RefObject<HTMLDivElement | null>;
    masterLevelText: RefObject<HTMLSpanElement | null>;
    engineState: RefObject<HTMLSpanElement | null>;
};

/**
 * Drives StatusBar CPU / memory / latency / level meters at animation-frame rate
 * via direct DOM mutations (bypassing React renders for performance).
 */
export const useStatusBarMetrics = (refs: StatusBarMetricRefs): void => {
    const idRef = useRef(crypto.randomUUID());
    const lastFrameRef = useRef(0);
    const cpuSamplesRef = useRef<number[]>([]);

    useEffect(() => {
        lastFrameRef.current = performance.now();

        const tick = (): void => {
            const now = performance.now();
            const frameDelta = now - lastFrameRef.current;
            lastFrameRef.current = now;

            const engineInfo = getEngineState();
            const masterLevel = getMasterPeakLevel();

            // ── CPU load estimate ───────────────────────────────────────
            // Combine audio thread load (baseLatency as proxy) with UI frame budget usage.
            // baseLatency / (128/sampleRate) approximates audio thread utilization.
            const bufferDuration = 128 / (engineInfo?.sampleRate ?? 44100);
            const audioLoad = engineInfo?.baseLatency
                ? Math.min(100, (engineInfo.baseLatency / bufferDuration) * 100)
                : 0;
            const targetFrameMs = 1000 / 60;
            const frameLoad = frameDelta > targetFrameMs
                ? Math.min(100, ((frameDelta - targetFrameMs) / targetFrameMs) * 200)
                : 0;
            const load = Math.max(audioLoad, frameLoad);
            const samples = cpuSamplesRef.current;
            samples.push(Math.max(0, load));
            if (samples.length > 30) {
                samples.shift();
            }
            let sum = 0;
            for (let i = 0; i < samples.length; i++) {
                sum += samples[i]!;
            }
            const cpuPct = Math.round(sum / samples.length);

            if (refs.cpuBar.current) {
                refs.cpuBar.current.style.width = `${Math.min(100, cpuPct)}%`;
                refs.cpuBar.current.className = `h-full rounded-full transition-[width] duration-150 ${
                    cpuPct < 50
                        ? 'bg-[var(--color-state-success)]'
                        : cpuPct < 80
                          ? 'bg-[var(--color-state-warning)]'
                          : 'bg-[var(--color-state-danger)]'
                }`;
            }
            if (refs.cpuText.current) {
                refs.cpuText.current.textContent = `${cpuPct}%`;
            }

            // ── Memory ──────────────────────────────────────────────────
            const perfMemory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
            if (perfMemory) {
                const memMb = Math.round(perfMemory.usedJSHeapSize / (1024 * 1024));
                if (refs.memContainer.current) {
                    refs.memContainer.current.style.display = memMb > 0 ? 'flex' : 'none';
                }
                if (refs.memText.current) {
                    refs.memText.current.textContent = `${memMb} MB`;
                }
            } else {
                if (refs.memContainer.current) {
                    refs.memContainer.current.style.display = 'none';
                }
            }

            // ── Audio engine info ───────────────────────────────────────
            if (refs.sampleRate.current) {
                refs.sampleRate.current.textContent = `${engineInfo.sampleRate / 1000}kHz`;
            }
            if (refs.latency.current) {
                refs.latency.current.textContent = `${(engineInfo.baseLatency * 1000).toFixed(1)}ms`;
            }
            if (refs.engineState.current) {
                refs.engineState.current.className = `size-1.5 rounded-full ${
                    engineInfo.state === 'running' ? 'bg-[var(--color-state-success)]' : 'bg-muted-foreground/50'
                }`;
                refs.engineState.current.title = `Engine: ${engineInfo.state}`;
            }

            // ── Master level ────────────────────────────────────────────
            const levelDb = masterLevel > 0 ? (20 * Math.log10(masterLevel)).toFixed(1) : '-∞';
            if (refs.masterLevelBar.current) {
                refs.masterLevelBar.current.style.width = `${Math.min(100, masterLevel * 300)}%`;
            }
            if (refs.masterLevelText.current) {
                refs.masterLevelText.current.textContent = `${levelDb} dB`;
            }
        };

        animationScheduler.register(`status-${idRef.current}`, tick);
        return () => animationScheduler.unregister(`status-${idRef.current}`);
    }, [refs]);
};
