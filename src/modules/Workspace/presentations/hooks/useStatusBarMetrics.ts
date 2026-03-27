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
    const idleDeadlineRef = useRef(-1);

    useEffect(() => {
        lastFrameRef.current = performance.now();

        // requestIdleCallback loop — measures how much idle time the browser has
        let idleId = 0;
        const scheduleIdle = (): void => {
            if (typeof requestIdleCallback === 'function') {
                idleId = requestIdleCallback((deadline) => {
                    idleDeadlineRef.current = deadline.timeRemaining();
                    scheduleIdle();
                });
            }
        };
        scheduleIdle();

        const tick = (): void => {
            const now = performance.now();
            const frameDelta = now - lastFrameRef.current;
            lastFrameRef.current = now;

            const engineInfo = getEngineState();
            const masterLevel = getMasterPeakLevel();

            // ── CPU load estimate ───────────────────────────────────────
            // Uses requestIdleCallback to measure how much of each frame is
            // consumed by work. If the browser has no idle time, CPU is high.
            // This is the most accurate browser-available method short of
            // AudioWorklet self-timing.
            const targetFrameMs = 1000 / 60;

            // Frame overrun: how much we exceeded the 16.67ms budget
            const frameOverrun = Math.max(0, frameDelta - targetFrameMs);
            const frameLoad = Math.min(100, (frameOverrun / targetFrameMs) * 120);

            // Idle time measurement: if the browser reports idle time via
            // the idleDeadline ref, use it to estimate how busy the main thread is.
            // No idle time = 100% busy. Full idle time (~50ms) = 0% busy.
            let idleLoad = 0;
            const deadline = idleDeadlineRef.current;
            if (deadline >= 0) {
                // deadline is the remaining idle ms (0 = fully busy, 50 = fully idle)
                idleLoad = Math.min(100, Math.max(0, (1 - deadline / 50) * 100));
                idleDeadlineRef.current = -1; // consumed
            }

            // Combine: higher of frame jank or idle pressure
            const isPlaying = engineInfo?.state === 'running';
            const floor = isPlaying ? 3 : 0;
            const load = Math.max(floor, frameLoad, idleLoad);
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
        return () => {
            animationScheduler.unregister(`status-${idRef.current}`);
            if (typeof cancelIdleCallback === 'function' && idleId) {
                cancelIdleCallback(idleId);
            }
        };
    }, [refs]);
};
