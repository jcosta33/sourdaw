import { type RefObject, useEffect, useRef } from 'react';

import { getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import {
    getEngineDiagnostics,
    getEngineHealth,
    getEngineState,
    getMasterPeakLevel,
    refreshEngineRtDiagnostics,
} from '#/modules/AudioEngine/useCases';
import { animationScheduler } from '#/utils/DOM/AnimationScheduler';

import { updateTextNode } from '../helpers/updateTextNode';

/**
 * Refs for DOM elements that StatusBar updates at animation-frame rate via direct mutation.
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

type DescribeDropoutsInput = {
    playback: ReturnType<typeof getEngineDiagnostics>['playback'];
    health: ReturnType<typeof getEngineHealth>;
};

/**
 * The engine's two dropout signals, rendered into the engine-status tooltip.
 *
 * Both were computed and thrown away before this: `getEngineDiagnostics()` has
 * sampled `AudioContext.playbackStats` on every tick since it was written and
 * the tooltip only ever read `.graph`, and `getHealth()` had no production
 * reader at all. A dropout counter nobody can see is worth about as much as no
 * counter, so the pair is surfaced here.
 *
 * They count different things and must not be added together:
 *
 * - **Missed render deadlines** come from `AudioContext.playbackStats`. The
 *   output sink asked for frames the render thread had not produced, whatever
 *   the cause — DSP overrun, GC pause, a stalled worker. This is the broad
 *   signal, and `scripts/measureRenderDeadline.ts` is the harness that proves
 *   it actually fires. It reads `unavailable` in fallback mode, where there is
 *   no live `AudioContext` to sample.
 * - **Engine-detected dropouts** come from the worklet-side counters in
 *   `engine/dropoutCounter.ts`. Narrow by construction: today the only detector
 *   is Grand Boule's ring-buffer starvation, and it needs `SharedArrayBuffer`
 *   (so cross-origin isolation) to report anything at all. Non-zero is always a
 *   real problem; zero is not a clean bill of health.
 */
function describeDropouts({ playback, health }: DescribeDropoutsInput): string {
    if (!playback) {
        return ` · missed render deadlines: unavailable · engine-detected dropouts: ${String(health.dropouts.detectedUnderrunBlocks)}`;
    }
    const underrunMs = (playback.underrunDuration * 1000).toFixed(1);
    return (
        ` · missed render deadlines: ${String(playback.underrunEvents)} (${underrunMs} ms)` +
        ` · engine-detected dropouts: ${String(health.dropouts.detectedUnderrunBlocks)}`
    );
}

/**
 * Drives StatusBar CPU / memory / latency / level meters at animation-frame rate
 * via direct DOM mutations (bypassing React renders for performance).
 */
export const useStatusBarMetrics = (refs: StatusBarMetricRefs): void => {
    const lastFrameRef = useRef(0);
    // §162.x — ring buffer for CPU samples. 30-entry Array.shift() on
    // every status-bar tick was O(n); fixed-size Float32Array + head
    // index gives O(1) push.
    const CPU_SAMPLE_WINDOW = 30;
    const cpuSamplesRef = useRef<Float32Array>(new Float32Array(CPU_SAMPLE_WINDOW));
    const cpuHeadRef = useRef(0);
    const cpuFilledRef = useRef(0);
    const idleDeadlineRef = useRef(-1);
    const lastDiagnosticsAtRef = useRef(Number.NEGATIVE_INFINITY);
    const engineDiagnosticsTitleRef = useRef('');

    useEffect(() => {
        const animationId = `status-${crypto.randomUUID()}`;
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
            if (now - lastDiagnosticsAtRef.current >= 1_000) {
                // The native engine publishes stream errors into a bounded ring
                // that only this command drains. Nothing else calls it in the
                // running app, so without this the ring fills once and every
                // later report is dropped at the push. Fire-and-forget: the tick
                // is synchronous and the payload is read from the store.
                void refreshEngineRtDiagnostics();
                const diagnostics = getEngineDiagnostics();
                const health = getEngineHealth();
                const dropoutSummary = describeDropouts({ playback: diagnostics.playback, health });
                const deviceTypes = Object.entries(diagnostics.graph.deviceInstancesByType)
                    .map(([type, count]) => `${type}: ${String(count)}`)
                    .join(', ');
                const deviceTypeSummary = deviceTypes.length > 0 ? ` (${deviceTypes})` : '';
                engineDiagnosticsTitleRef.current =
                    ` · audio track strips: ${String(diagnostics.graph.trackStrips)}` +
                    ` · bus strips: ${String(diagnostics.graph.busStrips)}` +
                    ` · sends: ${String(diagnostics.graph.sends)}` +
                    ` · sidechains: ${String(diagnostics.graph.sidechains)}` +
                    ` · ready device instances: ${String(diagnostics.graph.deviceInstances)}${deviceTypeSummary}` +
                    ` · pending device instances: ${String(diagnostics.graph.pendingDeviceInstances)}` +
                    ` · failed device instances: ${String(diagnostics.graph.failedDeviceInstances)}` +
                    ` · device audio nodes: ${String(diagnostics.graph.deviceAudioNodes)}` +
                    ` · strip meter worklets: ${String(diagnostics.graph.stripMeterWorklets)}` +
                    ` · master meter worklets: ${String(diagnostics.graph.masterMeterWorklets)}` +
                    ` · adjustment-layer buses: ${String(diagnostics.graph.adjustmentLayerBuses)}` +
                    ` · tracked AudioScheduledSources: ${String(diagnostics.runtime.trackedAudioScheduledSources)}${dropoutSummary}`;
                lastDiagnosticsAtRef.current = now;
            }

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
            const isPlaying = engineInfo.state === 'running';
            const floor = isPlaying ? 3 : 0;
            const load = Math.max(floor, frameLoad, idleLoad);
            const samples = cpuSamplesRef.current;
            samples[cpuHeadRef.current] = Math.max(0, load);
            cpuHeadRef.current = (cpuHeadRef.current + 1) % CPU_SAMPLE_WINDOW;
            if (cpuFilledRef.current < CPU_SAMPLE_WINDOW) {
                cpuFilledRef.current++;
            }
            const filled = cpuFilledRef.current;
            let sum = 0;
            for (let index = 0; index < filled; index++) {
                sum += samples[index]!;
            }
            const cpuPct = filled > 0 ? Math.round(sum / filled) : 0;

            if (refs.cpuBar.current) {
                refs.cpuBar.current.style.width = `${Math.min(100, cpuPct)}%`;
                // Toggle only the color class so we don't clobber the
                // tailwind layout classes each frame (§136.1).
                const cls = refs.cpuBar.current.classList;
                cls.toggle('bg-[var(--color-state-success)]', cpuPct < 50);
                cls.toggle('bg-[var(--color-state-warning)]', cpuPct >= 50 && cpuPct < 80);
                cls.toggle('bg-[var(--color-state-danger)]', cpuPct >= 80);
            }
            updateTextNode(refs.cpuText.current, `${cpuPct}%`);

            // ── Memory ──────────────────────────────────────────────────
            // performance.memory is a Chrome non-standard extension not in TypeScript's lib.dom.d.ts
            const perfMemory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
            if (perfMemory) {
                const memMb = Math.round(perfMemory.usedJSHeapSize / (1024 * 1024));
                if (refs.memContainer.current) {
                    refs.memContainer.current.style.display = memMb > 0 ? 'flex' : 'none';
                }
                updateTextNode(refs.memText.current, `${memMb} MB`);
            } else {
                if (refs.memContainer.current) {
                    refs.memContainer.current.style.display = 'none';
                }
            }

            // ── Audio engine info ───────────────────────────────────────
            updateTextNode(refs.sampleRate.current, `${engineInfo.sampleRate / 1000}kHz`);

            // ── Output latency ──────────────────────────────────────────
            // Web Audio splits the output path into two *disjoint, successive*
            // segments, and this readout used to show only the first:
            //
            //   baseLatency   — "the number of seconds of processing latency
            //                   incurred by the AudioContext passing the audio
            //                   from the AudioDestinationNode to the audio
            //                   subsystem" (Web Audio API §1.2.2).
            //   outputLatency — "the interval between the time the UA requests
            //                   the host system to play a buffer and the time at
            //                   which the first sample in the buffer is actually
            //                   processed by the audio output device" (ibid.).
            //
            // Latency is additive, so the delay the user actually hears is the
            // sum; baseLatency alone silently drops the whole device buffer,
            // which is usually the larger of the two (256 vs 512 frames at 48 kHz
            // is 5.3 ms reported against 16.0 ms heard). outputLatency is an
            // estimate the spec allows to change while the context runs, so it is
            // read per tick alongside baseLatency rather than cached.
            //
            // This is the hardware output path only. Plug-in delay compensation
            // (getCompensationDelay / getMaxTrackLatency) aligns tracks against
            // each other *inside* the graph, upstream of AudioDestinationNode —
            // it is a different quantity, is not shown here, and adding it would
            // double-count delay this figure already covers downstream.
            const baseLatencyMs = engineInfo.baseLatency * 1000;
            const deviceLatencyMs = engineInfo.outputLatency * 1000;
            const outputLatencyMs = baseLatencyMs + deviceLatencyMs;
            updateTextNode(refs.latency.current, `${outputLatencyMs.toFixed(1)}ms`);
            // Compare before writing, the same way `updateTextNode` does: this
            // tick runs at animation-frame rate and the tooltip only moves when
            // the device buffer does, so an unguarded assignment would be ~60
            // attribute writes a second to say the same thing.
            //
            // Do NOT "align" this with `engineDiagnosticsTitleRef` below. That
            // ref throttles how often the diagnostics *string is built* (once a
            // second), but the assignment to `refs.engineState.current.title`
            // still runs on every frame — so it has this same defect and is not
            // the pattern to copy. The model here is `updateTextNode`'s own
            // `nodeValue !== value` check: compare against the live DOM, write
            // only on a real change, and stay correct across a remount.
            const latencyTitle =
                `Output latency ${outputLatencyMs.toFixed(1)} ms` +
                ` = context ${baseLatencyMs.toFixed(1)} ms` +
                ` + device ${deviceLatencyMs.toFixed(1)} ms.` +
                ' Hardware output path only — excludes plug-in delay compensation.';
            if (refs.latency.current && refs.latency.current.title !== latencyTitle) {
                refs.latency.current.title = latencyTitle;
            }

            if (refs.engineState.current) {
                refs.engineState.current.className = getDawStatusDotClassName({
                    tone: engineInfo.state === 'running' ? 'success' : 'muted',
                });
                refs.engineState.current.title = `Engine: ${engineInfo.state}${engineDiagnosticsTitleRef.current}`;
            }

            // ── Master level ────────────────────────────────────────────
            // `null` is not zero. It means the engine has no meter tap at all —
            // initialize() has not finished, its worklet load failed, or the page
            // is missing AudioWorklet/SharedArrayBuffer. Rendering "-∞ dB" there
            // is the readout for a genuinely silent mix, so it tells a user whose
            // audio is playing that the engine is dead. Say "n/a" instead.
            if (masterLevel === null) {
                if (refs.masterLevelBar.current) {
                    refs.masterLevelBar.current.style.width = '0%';
                }
                updateTextNode(refs.masterLevelText.current, 'n/a');
                return;
            }

            const levelDb = masterLevel > 0 ? (20 * Math.log10(masterLevel)).toFixed(1) : '-∞';
            if (refs.masterLevelBar.current) {
                refs.masterLevelBar.current.style.width = `${Math.min(100, masterLevel * 300)}%`;
            }
            updateTextNode(refs.masterLevelText.current, `${levelDb} dB`);
        };

        animationScheduler.register(animationId, tick);
        return () => {
            animationScheduler.unregister(animationId);
            if (typeof cancelIdleCallback === 'function' && idleId) {
                cancelIdleCallback(idleId);
            }
        };
    }, [refs]);
};
