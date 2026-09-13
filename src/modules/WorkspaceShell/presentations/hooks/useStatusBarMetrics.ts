import { type RefObject, useEffect, useRef } from 'react';

import { getDawStatusDotClassName } from '#/components/daw/DawStatusDot';
import {
    getEngineDiagnostics,
    getEngineHealth,
    getEngineState,
    getMasterPeakLevel,
    readNativeEngineStatus,
    readNativeOutputLatency,
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

type DescribeOutputLatencyInput = {
    native: ReturnType<typeof readNativeOutputLatency>;
    nativeStatus: ReturnType<typeof readNativeEngineStatus>;
    engineInfo: ReturnType<typeof getEngineState>;
};

type OutputLatencyDescription = {
    /** Milliseconds, or `null` when the audible engine has published no figure. */
    outputLatencyMs: number | null;
    title: string;
};

/**
 * The output-latency tooltip's fixed shape: a total, split into the buffer
 * term (labeled per carrier — the native engine's own buffer, or Web Audio's
 * context) and the device term, with the standing caveat that this path
 * excludes plug-in delay compensation.
 */
function outputLatencyTitle(bufferLabel: string, bufferMs: number, deviceMs: number): string {
    const totalMs = bufferMs + deviceMs;
    return (
        `Output latency ${totalMs.toFixed(1)} ms` +
        ` = ${bufferLabel} ${bufferMs.toFixed(1)} ms` +
        ` + device ${deviceMs.toFixed(1)} ms.` +
        ' Hardware output path only — excludes plug-in delay compensation.'
    );
}

/**
 * The output-latency readout and its tooltip breakdown.
 *
 * The readout follows the audible carrier. When Web Audio carries the
 * monitor, its `baseLatency + outputLatency` sum is the delay the listener
 * hears, so it is the readout. When the native session carries the monitor,
 * Web Audio's context figures describe a path nobody is on: they are real
 * numbers about the wrong engine, and showing them while the native figure
 * has not landed would substitute a healthy context's latency for the
 * native engine's absent one — so the readout says n/a instead (#3706).
 */
function describeOutputLatency({
    native,
    nativeStatus,
    engineInfo,
}: DescribeOutputLatencyInput): OutputLatencyDescription {
    if (nativeStatus.audibleCarrier) {
        if (native) {
            const contextMs = native.contextSeconds * 1000;
            const deviceMs = native.deviceSeconds * 1000;
            return {
                outputLatencyMs: contextMs + deviceMs,
                title: outputLatencyTitle('native engine buffer', contextMs, deviceMs),
            };
        }
        return {
            outputLatencyMs: null,
            title:
                'Native engine is the audible output; its output latency has not been published.' +
                ' Web Audio figures would describe a path nobody hears.',
        };
    }
    const baseLatencyMs = engineInfo.baseLatency * 1000;
    const deviceLatencyMs = engineInfo.outputLatency * 1000;
    return {
        outputLatencyMs: baseLatencyMs + deviceLatencyMs,
        title: outputLatencyTitle('context', baseLatencyMs, deviceLatencyMs),
    };
}

type DescribeEngineIndicatorInput = {
    nativeStatus: ReturnType<typeof readNativeEngineStatus>;
    engineInfo: ReturnType<typeof getEngineState>;
    diagnosticsSummary: string;
};

type EngineIndicator = {
    tone: 'muted' | 'success' | 'warning' | 'danger';
    title: string;
};

/**
 * The engine dot's tone and tooltip, named for the engine they describe.
 *
 * The dot answers "is the engine I am hearing healthy", so its source follows
 * the audible carrier: while the native session is what a musician hears, its
 * running state and output-stream fault decide the tone and Web Audio's
 * context state is named but never substituted for them (#3706). `warning`
 * keeps a running engine visible as degraded; a carrier that stopped
 * rendering is `danger`, and a carrier with no diagnostics reading yet is
 * `muted` — no reading is not a failure.
 */
function describeEngineIndicator({
    nativeStatus,
    engineInfo,
    diagnosticsSummary,
}: DescribeEngineIndicatorInput): EngineIndicator {
    const webAudioSuffix = ` · Web Audio: ${engineInfo.state}`;
    if (nativeStatus.audibleCarrier) {
        const diagnostics = nativeStatus.diagnostics;
        if (!diagnostics) {
            return {
                tone: 'muted',
                title: `Engine: native (no reading yet)${webAudioSuffix}${diagnosticsSummary}`,
            };
        }
        if (!diagnostics.running) {
            return {
                tone: 'danger',
                title: `Engine: native stopped${webAudioSuffix}${diagnosticsSummary}`,
            };
        }
        if (diagnostics.outputStreamFault) {
            return {
                tone: 'warning',
                title: `Engine: native running · native output stream fault: ${diagnostics.outputStreamFault}${webAudioSuffix}${diagnosticsSummary}`,
            };
        }
        return {
            tone: 'success',
            title: `Engine: native running${webAudioSuffix}${diagnosticsSummary}`,
        };
    }
    return {
        tone: engineInfo.state === 'running' ? 'success' : 'muted',
        title: `Engine: Web Audio ${engineInfo.state}${diagnosticsSummary}`,
    };
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
    // The display's own cadence, approximated by the smallest recent
    // inter-tick interval; see the load estimate below for why a fixed
    // 60 Hz budget cannot be the reference.
    const FRAME_CADENCE_WINDOW = 30;
    const frameDeltasRef = useRef<Float32Array>(new Float32Array(FRAME_CADENCE_WINDOW));
    const frameDeltasHeadRef = useRef(0);
    const frameDeltasFilledRef = useRef(0);
    // False until the first idle callback proves the idle loop is being
    // serviced; frames observed before that say nothing about busyness.
    const hasSeenIdleSampleRef = useRef(false);
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
                // that only this command drains. Two callers share that drain
                // while a native session stands — this tick and the live
                // session's liveness watch (`watchNativeEngineLiveness.ts`) —
                // both through this same use case and into the one store it
                // publishes to, so neither loses events to the other. Without
                // at least one of them running, the ring fills once and every
                // later report is dropped at the push. Fire-and-forget:
                // the tick is synchronous and the payload is read from the
                // store.
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

            // ── Main-thread load estimate ───────────────────────────────
            // A busyness estimate for the main thread, from two observables.
            // It is not CPU utilization and says nothing about the audio
            // thread; the engine dot owns audio health.
            //
            // - Idle occupancy. With a page that keeps requesting animation
            //   frames, W3C requestidlecallback bounds an idle period by the
            //   next frame — the 50 ms figure in the spec is a cap for
            //   otherwise unbounded idle periods, not a per-frame budget.
            //   `timeRemaining()` of the sample that landed in a frame,
            //   divided by that frame's own interval, is the idle share; its
            //   complement is the busy share. A frame in which no idle
            //   callback was dispatched had no idle time at all — full
            //   scheduling pressure for that frame. Before the first idle
            //   sample arrives the loop is unproven, and a missing sample
            //   means nothing.
            // - Frame overrun. Against the display's own cadence, not a fixed
            //   60 Hz budget: the smallest recent inter-tick interval
            //   approximates the refresh interval, so time above it is jank
            //   whether the display runs at 30, 60, or 120 Hz. A fixed budget
            //   here classified a normally paced 30 Hz display as fully
            //   loaded, and the old fixed 50 ms idle budget read an
            //   almost-idle 60 Hz UI as ~70% loaded purely from cadence.
            const deltas = frameDeltasRef.current;
            deltas[frameDeltasHeadRef.current] = frameDelta;
            frameDeltasHeadRef.current = (frameDeltasHeadRef.current + 1) % FRAME_CADENCE_WINDOW;
            if (frameDeltasFilledRef.current < FRAME_CADENCE_WINDOW) {
                frameDeltasFilledRef.current++;
            }
            let cadenceMs = frameDelta;
            for (let index = 0; index < frameDeltasFilledRef.current; index++) {
                const sample = deltas[index]!;
                if (sample > 0 && sample < cadenceMs) {
                    cadenceMs = sample;
                }
            }

            const frameOverrunMs = Math.max(0, frameDelta - cadenceMs);
            const overrunLoad = cadenceMs > 0 ? Math.min(100, (frameOverrunMs / cadenceMs) * 100) : 0;

            const deadline = idleDeadlineRef.current;
            idleDeadlineRef.current = -1; // consumed
            let idleLoad = 0;
            if (deadline >= 0) {
                hasSeenIdleSampleRef.current = true;
                const idleWindowMs = Math.max(frameDelta, 1);
                idleLoad = Math.min(100, Math.max(0, (1 - deadline / idleWindowMs) * 100));
            } else if (hasSeenIdleSampleRef.current) {
                idleLoad = 100;
            }

            const load = Math.max(overrunLoad, idleLoad);
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

            // ── Sample rate ─────────────────────────────────────────────
            // The rate readout names its source. While the native session is
            // the audible carrier, the Web Audio context's rate describes the
            // engine nobody hears — the native output stream's own opened rate
            // is the honest figure, and until the diagnostics publish one the
            // readout says n/a rather than borrowing the context's (#3706).
            const nativeStatus = readNativeEngineStatus();
            const rateTitle = nativeStatus.audibleCarrier
                ? 'Native engine output stream rate'
                : 'Web Audio context sample rate';
            if (nativeStatus.audibleCarrier) {
                const nativeSampleRate = nativeStatus.diagnostics?.sampleRate ?? 0;
                updateTextNode(refs.sampleRate.current, nativeSampleRate > 0 ? `${nativeSampleRate / 1000}kHz` : 'n/a');
            } else {
                updateTextNode(refs.sampleRate.current, `${engineInfo.sampleRate / 1000}kHz`);
            }
            if (refs.sampleRate.current && refs.sampleRate.current.title !== rateTitle) {
                refs.sampleRate.current.title = rateTitle;
            }

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
            //
            // The native session can become the audible carrier (see the
            // carrier law docs on `nativeLiveGraphSessionState.ts`), and once it
            // does, Web Audio's own context and device figures describe a path
            // nobody is hearing — `describeOutputLatency` reads whichever side
            // is actually carrying the monitor.
            const native = readNativeOutputLatency();
            const { outputLatencyMs, title: latencyTitle } = describeOutputLatency({
                native,
                nativeStatus,
                engineInfo,
            });
            updateTextNode(refs.latency.current, outputLatencyMs === null ? 'n/a' : `${outputLatencyMs.toFixed(1)}ms`);
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
            if (refs.latency.current && refs.latency.current.title !== latencyTitle) {
                refs.latency.current.title = latencyTitle;
            }

            const indicator = describeEngineIndicator({
                nativeStatus,
                engineInfo,
                diagnosticsSummary: engineDiagnosticsTitleRef.current,
            });
            if (refs.engineState.current) {
                const dot = refs.engineState.current;
                const nextClassName = getDawStatusDotClassName({ tone: indicator.tone });
                if (dot.className !== nextClassName) {
                    dot.className = nextClassName;
                }
                if (dot.title !== indicator.title) {
                    dot.title = indicator.title;
                }
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
