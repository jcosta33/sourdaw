import { getTrackStoreState, getMidiStoreState, getAutomationLanes } from '#/modules/Arrangement/useCases/trackQueries';
import { getTransportStoreValue, getTempoMapState } from '#/modules/Transport/useCases/transportQueries';
import { audioBufferCache } from '../stores/audioBufferCache';
import { buildDeviceChain } from './buildDeviceChain';
import { scheduleNoteOffline, getSynthParamsFromDevices } from '#/modules/Synth/useCases/builtinSynth';
import { scheduleKitNote } from '#/modules/Synth/useCases/drumKitSynth';
import { getDrumKitDefByIndex, scheduleDrumKitNote } from '#/modules/Synth/useCases/drumSynthEngine';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases/resolveComping';
import { beatToSeconds, resolveDrumKit, scheduleTrackAutomation } from '../repositories/offlineScheduler';

// Re-export encoders for consumers
export { audioBufferToWav, audioBufferToMp3, audioBufferToFlac } from '../repositories/audioEncoders';

// ── Cancel token ─────────────────────────────────────────────────────
let cancelFlag = false;
/**
 * True while a render is in progress. Used to prevent concurrent exports,
 * which would corrupt the shared cancelFlag and leak OfflineAudioContext.
 */
let isRenderingActive = false;

export function cancelExport(): void {
    cancelFlag = true;
}

/** Throws if a cancel was requested. */
function checkCancel(): void {
    if (cancelFlag) {
        throw new Error('Export cancelled');
    }
}

/**
 * Acquires the render lock. Throws if another render is already running.
 * Returns a release function that MUST be called in a finally block.
 */
function acquireRenderLock(): () => void {
    if (isRenderingActive) {
        throw new Error('An export is already in progress. Cancel the current export before starting a new one.');
    }
    isRenderingActive = true;
    return () => { isRenderingActive = false; };
}

/**
 * Whether a render (mixdown or stems) is currently in progress.
 * Consumers can read this to prevent a second export from being triggered.
 */
export function isExportActive(): boolean {
    return isRenderingActive;
}

// ── Export options ────────────────────────────────────────────────────
export type OfflineRenderOptions = {
    durationBeats: number;
    sampleRate?: number;
    onProgress?: (fraction: number) => void;
    /** Called when a non-fatal issue is detected (e.g. missing audio buffer). */
    onWarning?: (message: string) => void;
};

const MICRO_FADE_SECONDS = 0.003;
const RENDER_TIMEOUT_MS = 300_000;  // 5 min timeout for large projects
const YIELD_EVERY_N_NOTES = 200;    // yield to main thread every N notes
/** Shared easing coefficient for simulated render-phase progress (both mixdown and stems). */
const PROGRESS_EASE_COEFF = 0.025;
/**
 * Maximum OfflineAudioContext frame length. Chrome enforces 2^30; Firefox is
 * higher but we cap conservatively to avoid OOM on both.
 */
const MAX_OFFLINE_FRAMES = 2 ** 30;  // ~6.2 hours at 48 kHz

/** Yield to the main thread so the UI can update. */
function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A pending note event for a worklet instrument.
 * Collected across all tracks, then scheduled via suspend()/resume()
 * on the OfflineAudioContext as a single deduplicated pass.
 */
type PendingWorkletEvent = {
    time: number;
    type: 'on' | 'off';
    pitch: number;
    velocity: number;
    instrumentControls: NonNullable<import('./buildDeviceChain').DeviceNodeEntry['instrumentControls']>;
    isToaster: boolean;
    /** For Toaster child tracks: fixed pad index (0-15). -1 means derive from pitch. */
    toasterPadIndex: number;
};

/**
 * Register suspend points on the OfflineAudioContext for all collected
 * worklet note events. Must be called ONCE after ALL tracks are scheduled
 * and BEFORE startRendering().
 *
 * Events at the same quantized time (render quantum = 128 frames) are batched
 * into a single suspend() call to avoid InvalidStateError.
 */
function schedulePendingSuspends(
    offlineCtx: OfflineAudioContext,
    events: PendingWorkletEvent[],
    durationSeconds: number
): void {
    if (events.length === 0) {
        return;
    }

    // Sort by time, then noteOff before noteOn at same time (release before re-trigger)
    events.sort((a, b) => a.time - b.time || (a.type === 'off' ? -1 : 1));

    const quantumDuration = 128 / offlineCtx.sampleRate;
    const batchedByTime = new Map<number, PendingWorkletEvent[]>();

    for (const evt of events) {
        // Clamp to (0, duration) — can't suspend at 0 or beyond the render length
        const clampedTime = Math.max(quantumDuration, Math.min(evt.time, durationSeconds - quantumDuration));
        const quantized = Math.floor(clampedTime / quantumDuration) * quantumDuration;
        const batch = batchedByTime.get(quantized);
        if (batch) {
            batch.push(evt);
        } else {
            batchedByTime.set(quantized, [evt]);
        }
    }

    for (const [suspendTime, batch] of batchedByTime) {
        offlineCtx.suspend(suspendTime).then(() => {
            for (const evt of batch) {
                if (evt.type === 'on') {
                    if (evt.isToaster) {
                        const pad = evt.toasterPadIndex >= 0 ? evt.toasterPadIndex : (evt.pitch % 16);
                        evt.instrumentControls.noteOn(pad, evt.velocity, evt.pitch);
                    } else {
                        evt.instrumentControls.noteOn(evt.pitch, evt.velocity);
                    }
                } else {
                    if (evt.isToaster) {
                        const pad = evt.toasterPadIndex >= 0 ? evt.toasterPadIndex : (evt.pitch % 16);
                        evt.instrumentControls.noteOff(pad);
                    } else {
                        evt.instrumentControls.noteOff(evt.pitch);
                    }
                }
            }
            offlineCtx.resume();
        });
    }
}

/**
 * Schedule a single track's clips into the given OfflineAudioContext.
 * Shared between mixdown and stem paths to avoid duplication.
 *
 * Worklet instrument note events are pushed to `pendingWorkletEvents`
 * rather than scheduling suspend() directly — the caller must invoke
 * `schedulePendingSuspends()` once after all tracks are processed.
 */
async function scheduleTrackClips(
    offlineCtx: OfflineAudioContext,
    track: ReturnType<typeof getTrackStoreState> extends { tracks: (infer T)[] } | null ? T : never,
    midi: NonNullable<ReturnType<typeof getMidiStoreState>>,
    trackGain: GainNode,
    trackPan: StereoPannerNode,
    destination: AudioNode,
    durationSeconds: number,
    defaultTempo: number,
    changes: ReturnType<typeof getTempoMapState> extends { changes: infer C } | null ? C : never,
    onWarning?: (message: string) => void,
    pendingWorkletEvents?: PendingWorkletEvent[],
    allTracks?: ReadonlyArray<ReturnType<typeof getTrackStoreState> extends { tracks: (infer T)[] } | null ? T : never>,
    deviceEntriesByTrack?: Map<string, import('./buildDeviceChain').DeviceNodeEntry[]>
): Promise<void> {
    if (track.frozen && track.frozenBufferId) {
        trackGain.connect(trackPan);
        trackPan.connect(destination);

        const frozenBuf = audioBufferCache.get(track.frozenBufferId);
        if (frozenBuf) {
            const source = offlineCtx.createBufferSource();
            source.buffer = frozenBuf;
            source.connect(trackGain);
            source.start(0);
        } else {
            onWarning?.(
                `Track "${track.name}" is frozen but its frozen buffer is missing and will be silent in the export. ` +
                `Try unfreezing and re-freezing the track.`
            );
        }
        return;
    }

    const automationLanes = getAutomationLanes();
    const deviceEntries = await buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
    trackPan.connect(destination);

    scheduleTrackAutomation(
        automationLanes,
        track.id,
        trackGain,
        trackPan,
        deviceEntries,
        durationSeconds,
        defaultTempo,
        changes
    );

    const resolvedClips = resolveClipsWithComping(track.id, track.clips);

    for (const clip of resolvedClips) {
        // Skip muted clips — they should not render audio
        if (clip.muted) {
            continue;
        }

        const clipVisualLength = clip.endBeat - clip.startBeat;
        // Skip degenerate clips (endBeat <= startBeat or zero-length)
        if (clipVisualLength <= 0) {
            continue;
        }

        const rawLoopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
        // Guard against corrupt loopLength (zero or negative would cause infinite loops / NaN)
        const loopLen = rawLoopLen > 0 ? rawLoopLen : clipVisualLength;
        const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;

        if (clip.type === 'midi') {
            const notes = midi.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            const drumKit = resolveDrumKit(track.devices);
            // Only resolve kitDef when the track actually has a drum kit device.
            const drumKitDevice = track.devices.find(
                (d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit'
            );
            const kitDef = drumKitDevice
                ? getDrumKitDefByIndex(drumKitDevice.parameterValues.kit ?? drumKitDevice.parameterValues.kitId ?? 0)
                : null;

            // Check if any device in the chain exposes instrument controls (Fermenter/Toaster/Levain).
            // These worklet instruments are now fully instantiated on the OfflineAudioContext —
            // notes are driven by suspend()/resume() scheduling below.
            let instrumentEntry = deviceEntries.find((e) => e.instrumentControls);
            let instrumentControls = instrumentEntry?.instrumentControls ?? null;
            let isToaster = instrumentEntry?.deviceType === 'toaster';
            let toasterPadIndex = -1; // only used for Toaster child tracks

            // Toaster child track routing: if this track has a parentId and the
            // parent track has a Toaster device, route notes to the parent's Toaster
            // using the child's index among siblings as the pad number.
            if (!instrumentControls && track.parentId && allTracks && deviceEntriesByTrack) {
                const parentTrack = allTracks.find((t) => t.id === track.parentId);
                if (parentTrack?.devices.some((d) => d.type === 'toaster')) {
                    const parentEntries = deviceEntriesByTrack.get(parentTrack.id);
                    const parentInstrument = parentEntries?.find((e) => e.instrumentControls);
                    if (parentInstrument?.instrumentControls) {
                        instrumentControls = parentInstrument.instrumentControls;
                        isToaster = true;
                        // Pad index = child's position among siblings
                        const children = allTracks.filter((t) => t.parentId === parentTrack.id);
                        toasterPadIndex = children.findIndex((t) => t.id === track.id);
                    }
                }
            }

            // For non-worklet, non-drum-kit tracks: use the basic oscillator synth fallback
            const synthParams = drumKit || kitDef || instrumentControls
                ? null
                : getSynthParamsFromDevices(track.devices);

            let noteCount = 0;

            // Collect all note events for worklet scheduling (sorted by time).
            // We batch events at the same quantized time to avoid duplicate suspend() calls.
            type NoteEvent = { time: number; type: 'on' | 'off'; pitch: number; velocity: number; duration: number };
            const workletEvents: NoteEvent[] = [];

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffset = iter * loopLen;

                for (const note of notes) {
                    if (note.startBeat >= loopLen) {
                        continue;
                    }
                    if (note.startBeat + note.duration <= 0) {
                        continue;
                    }

                    const noteAbsStart = clip.startBeat + iterOffset + note.startBeat;
                    if (noteAbsStart >= clip.endBeat) {
                        continue;
                    }

                    const startTime = beatToSeconds(noteAbsStart, defaultTempo, changes);
                    const noteEndBeat = Math.min(noteAbsStart + note.duration, clip.endBeat);
                    const endTime = beatToSeconds(noteEndBeat, defaultTempo, changes);
                    const duration = endTime - startTime;
                    if (startTime >= durationSeconds || duration <= 0) {
                        continue;
                    }

                    if (instrumentControls) {
                        // Collect events for suspend/resume scheduling
                        workletEvents.push({ time: startTime, type: 'on', pitch: note.pitch, velocity: note.velocity, duration });
                        workletEvents.push({ time: endTime, type: 'off', pitch: note.pitch, velocity: 0, duration: 0 });
                    } else if (kitDef) {
                        scheduleDrumKitNote(offlineCtx, trackGain, kitDef, note.pitch, startTime, note.velocity);
                    } else if (drumKit) {
                        scheduleKitNote(offlineCtx, trackGain, drumKit, note.pitch, startTime, duration, note.velocity);
                    } else {
                        scheduleNoteOffline(
                            offlineCtx,
                            trackGain,
                            note.pitch,
                            startTime,
                            duration,
                            note.velocity,
                            synthParams!
                        );
                    }

                    // Yield periodically so the UI stays responsive
                    noteCount++;
                    if (noteCount % YIELD_EVERY_N_NOTES === 0) {
                        await yieldToMain();
                    }
                }
            }

            // Push worklet note events to the shared pending array.
            // They will be deduplicated and scheduled via suspend()/resume()
            // after ALL tracks have been processed.
            if (instrumentControls && workletEvents.length > 0 && pendingWorkletEvents) {
                for (const evt of workletEvents) {
                    pendingWorkletEvents.push({
                        time: evt.time,
                        type: evt.type,
                        pitch: evt.pitch,
                        velocity: evt.velocity,
                        instrumentControls,
                        isToaster,
                        toasterPadIndex,
                    });
                }
            }
        } else if (clip.type === 'audio' && clip.audioBufferId) {
            const buffer = audioBufferCache.get(clip.audioBufferId);
            if (!buffer) {
                onWarning?.(
                    `Audio clip "${clip.name}" is missing its audio buffer and will be silent in the export. ` +
                    `Try re-importing the file or reloading the project.`
                );
                continue;
            }

            const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;
            // Clamp stretchRatio to a sane positive range — zero or negative would
            // cause division-by-zero in `buffer.duration / stretchRatio`.
            const safeStretchRatio = Math.max(0.01, Math.min(100, stretchRatio));
            const clipGainValue = clip.gain; // linear scalar; 1.0 = unity

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterStartBeat = clip.startBeat + iter * loopLen;
                if (iterStartBeat >= clip.endBeat) {
                    break;
                }

                const iterStartTime = beatToSeconds(iterStartBeat, defaultTempo, changes);
                if (iterStartTime >= durationSeconds) {
                    break;
                }

                const isFirstIter = iter === 0;
                const isLastIter = iter === maxIterations - 1 || iterStartBeat + loopLen >= clip.endBeat;

                const remainingBeats = Math.min(loopLen, clip.endBeat - iterStartBeat);
                const iterEndTime = beatToSeconds(iterStartBeat + remainingBeats, defaultTempo, changes);
                const iterDurationSec = iterEndTime - iterStartTime;
                const playDuration = Math.min(iterDurationSec, buffer.duration / safeStretchRatio);

                // Skip this iteration if it resolves to zero or negative duration
                if (playDuration <= 0) {
                    continue;
                }

                const source = offlineCtx.createBufferSource();
                source.buffer = buffer;
                if (safeStretchRatio !== 1) {
                    source.playbackRate.value = safeStretchRatio;
                }

                const startSec = Math.max(0, iterStartTime);
                const endSec = startSec + playDuration;

                // Always route through a gain node for clip gain + fade envelope.
                const fadeGain = offlineCtx.createGain();
                source.connect(fadeGain);
                fadeGain.connect(trackGain);

                // Baseline: clip gain for mid-clip iterations (no fade)
                fadeGain.gain.setValueAtTime(clipGainValue, startSec);

                // ── Fade in (first iteration only) ─────────────────────────────
                if (isFirstIter) {
                    if (clip.fadeInBeats > 0) {
                        // User-defined fade: ramp from silence over the specified beat count.
                        // Cap to half the iteration duration so it can never overlap the fade-out.
                        const fadeInEndBeat = clip.startBeat + clip.fadeInBeats;
                        const fadeInEndSec = beatToSeconds(fadeInEndBeat, defaultTempo, changes);
                        const fadeInDuration = Math.min(
                            Math.max(MICRO_FADE_SECONDS, fadeInEndSec - iterStartTime),
                            playDuration * 0.5
                        );
                        fadeGain.gain.setValueAtTime(0, startSec);
                        fadeGain.gain.linearRampToValueAtTime(clipGainValue, startSec + fadeInDuration);
                    } else {
                        // Micro-fade (3 ms) to suppress boundary click
                        fadeGain.gain.setValueAtTime(0, startSec);
                        fadeGain.gain.linearRampToValueAtTime(clipGainValue, startSec + MICRO_FADE_SECONDS);
                    }
                }

                // ── Fade out (last iteration only) ─────────────────────────────
                if (isLastIter) {
                    if (clip.fadeOutBeats > 0) {
                        // User-defined fade: ramp to silence over the specified beat count.
                        // Cap to half the iteration duration to mirror the fade-in cap.
                        const fadeOutStartBeat = clip.endBeat - clip.fadeOutBeats;
                        const fadeOutStartSec = beatToSeconds(fadeOutStartBeat, defaultTempo, changes);
                        const fadeOutOffset = Math.max(startSec, Math.max(fadeOutStartSec, endSec - playDuration * 0.5));
                        fadeGain.gain.setValueAtTime(clipGainValue, fadeOutOffset);
                        fadeGain.gain.linearRampToValueAtTime(0, endSec);
                    } else {
                        // Micro-fade (3 ms) to suppress boundary click
                        fadeGain.gain.setValueAtTime(clipGainValue, Math.max(startSec, endSec - MICRO_FADE_SECONDS));
                        fadeGain.gain.linearRampToValueAtTime(0, endSec);
                    }
                }

                // duration arg is destination-timeline seconds — NOT buffer-time scaled by playbackRate
                source.start(startSec, 0, playDuration);
            }
        }
    }
}

/**
 * Runs an offline render with a timeout guard to prevent stuck renders
 * from blocking the engine lock indefinitely.
 */
function renderWithTimeout(offlineCtx: OfflineAudioContext): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Offline render timed out after ${RENDER_TIMEOUT_MS / 1000}s`));
        }, RENDER_TIMEOUT_MS);

        offlineCtx.startRendering().then(
            (buffer) => {
                clearTimeout(timer);
                resolve(buffer);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

export async function renderOffline(opts: OfflineRenderOptions): Promise<AudioBuffer>;
export async function renderOffline(durationBeats: number, sampleRate?: number): Promise<AudioBuffer>;
export async function renderOffline(
    optsOrBeats: OfflineRenderOptions | number,
    maybeSampleRate?: number
): Promise<AudioBuffer> {
    const releaseLock = acquireRenderLock();

    try {
        // Reset cancel token inside the try so it is never reset when acquireRenderLock throws
        cancelFlag = false;

        const durationBeats = typeof optsOrBeats === 'number' ? optsOrBeats : optsOrBeats.durationBeats;
        const sampleRate = typeof optsOrBeats === 'number' ? (maybeSampleRate ?? 44100) : (optsOrBeats.sampleRate ?? 44100);
        const onProgress = typeof optsOrBeats === 'object' ? optsOrBeats.onProgress : undefined;
        const onWarning = typeof optsOrBeats === 'object' ? optsOrBeats.onWarning : undefined;

        // Validate durationBeats before creating the OfflineAudioContext
        if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
            throw new Error(`Invalid export duration: ${durationBeats} beats. Project may have no clips or corrupt clip data.`);
        }

        const transport = getTransportStoreValue();
        const tracks = getTrackStoreState();
        const midi = getMidiStoreState();
        const tempoMap = getTempoMapState();
        const defaultTempo = transport?.tempo ?? 120;
        const changes = tempoMap?.changes ?? [];
        const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);

        // Clamp frame count to browser-safe maximum to avoid context creation error
        const frameCount = Math.min(Math.ceil(durationSeconds * sampleRate), MAX_OFFLINE_FRAMES);
        const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
        const masterGain = offlineCtx.createGain();
        // Use the project's master gain level (stored as 0-100) rather than a hardcoded value
        masterGain.gain.value = Math.max(0, Math.min(1, (transport?.masterGain ?? 80) / 100));
        masterGain.connect(offlineCtx.destination);

        // Exclude muted, disabled, and structural (folder) tracks from the render.
        // Computed once here so schedulingFrac below can reuse it without a second filter pass.
        const eligible =
            tracks && midi
                ? tracks.tracks.filter((t) => !t.muted && !t.disabled && t.kind !== 'folder')
                : [];
        let scheduled = 0;
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        // Two-pass approach: build device chains first so child tracks (e.g. Toaster
        // drum pads) can look up their parent's instrument controls.
        type TrackNodes = { trackGain: GainNode; trackPan: StereoPannerNode };
        const trackNodesById = new Map<string, TrackNodes>();
        const deviceEntriesByTrack = new Map<string, import('./buildDeviceChain').DeviceNodeEntry[]>();

        // Pass 1: Build device chains for all eligible tracks
        for (const track of eligible) {
            checkCancel();

            const trackGain = offlineCtx.createGain();
            trackGain.gain.value = Math.max(0, track.gain);
            const trackPan = offlineCtx.createStereoPanner();
            trackPan.pan.value = Math.max(-1, Math.min(1, track.pan / 50));
            trackNodesById.set(track.id, { trackGain, trackPan });

            const entries = await buildDeviceChain(offlineCtx, track.devices, trackGain, trackPan);
            trackPan.connect(masterGain);
            deviceEntriesByTrack.set(track.id, entries);
        }

        // Pass 2: Schedule clips (with access to all device entries for parent lookups)
        for (const track of eligible) {
            checkCancel();

            const { trackGain, trackPan } = trackNodesById.get(track.id)!;

            await scheduleTrackClips(
                offlineCtx,
                track,
                midi!,
                trackGain,
                trackPan,
                masterGain,
                durationSeconds,
                defaultTempo,
                changes,
                onWarning,
                pendingWorkletEvents,
                eligible,
                deviceEntriesByTrack
            );

            scheduled++;
            onProgress?.((scheduled / eligible.length) * 0.5); // scheduling = 0-50%
        }

        // Register all worklet note suspend points ONCE after all tracks are scheduled.
        // This prevents duplicate suspend() calls when multiple tracks target the same frame.
        schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

        checkCancel();

        // Yield so the UI can paint the scheduling-complete mark before startRendering() blocks.
        await yieldToMain();

        // OfflineAudioContext.startRendering() emits no progress events — animate toward 97%
        // using an easing approach. eligible.length > 0 means scheduling reached 50%, so start
        // the simulation from there; otherwise start from 0.
        const schedulingFrac = eligible.length > 0 ? 0.5 : 0;
        let simFrac = schedulingFrac;
        const renderTimer = onProgress
            ? setInterval(() => {
                  simFrac += (0.97 - simFrac) * PROGRESS_EASE_COEFF;
                  onProgress(simFrac);
              }, 100)
            : null;

        const buffer = await renderWithTimeout(offlineCtx).finally(() => {
            if (renderTimer !== null) clearInterval(renderTimer);
        });

        onProgress?.(1);
        return buffer;
    } finally {
        releaseLock();
    }
}

export async function exportStems(opts: OfflineRenderOptions): Promise<Map<string, AudioBuffer>>;
export async function exportStems(durationBeats: number, sampleRate?: number): Promise<Map<string, AudioBuffer>>;
export async function exportStems(
    optsOrBeats: OfflineRenderOptions | number,
    maybeSampleRate?: number
): Promise<Map<string, AudioBuffer>> {
    const releaseLock = acquireRenderLock();

    try {
        // Reset cancel token inside the try so it is never reset when acquireRenderLock throws
        cancelFlag = false;

        const durationBeats = typeof optsOrBeats === 'number' ? optsOrBeats : optsOrBeats.durationBeats;
        const sampleRate = typeof optsOrBeats === 'number' ? (maybeSampleRate ?? 44100) : (optsOrBeats.sampleRate ?? 44100);
        const onProgress = typeof optsOrBeats === 'object' ? optsOrBeats.onProgress : undefined;
        const onWarning = typeof optsOrBeats === 'object' ? optsOrBeats.onWarning : undefined;

        if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
            throw new Error(`Invalid export duration: ${durationBeats} beats.`);
        }

        const tracks = getTrackStoreState();
        const midi = getMidiStoreState();
        const transport = getTransportStoreValue();
        const tempoMap = getTempoMapState();
        const defaultTempo = transport?.tempo ?? 120;
        const changes = tempoMap?.changes ?? [];
        const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);
        const stems = new Map<string, AudioBuffer>();

        if (!tracks || !midi) {
            onProgress?.(1);
            return stems;
        }

        // Exclude disabled and structural tracks; muted tracks are included as stems
        // (users may want silent-in-mixdown stems for later use in a DAW).
        const eligible = tracks.tracks.filter((t) => !t.disabled && t.kind !== 'folder' && t.kind !== 'master');
        let done = 0;

        // Edge case: no eligible tracks — still complete progress
        if (eligible.length === 0) {
            onProgress?.(1);
            return stems;
        }

        const frameCount = Math.min(Math.ceil(durationSeconds * sampleRate), MAX_OFFLINE_FRAMES);

        for (const track of eligible) {
            checkCancel();

            const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
            const trackGain = offlineCtx.createGain();
            trackGain.gain.value = Math.max(0, track.gain);
            const trackPan = offlineCtx.createStereoPanner();
            // Mirror TrackNode.setPan: pan is -100..100, StereoPanner expects -1..1
            trackPan.pan.value = Math.max(-1, Math.min(1, track.pan / 50));

            const pendingWorkletEvents: PendingWorkletEvent[] = [];

            await scheduleTrackClips(
                offlineCtx,
                track,
                midi,
                trackGain,
                trackPan,
                offlineCtx.destination,
                durationSeconds,
                defaultTempo,
                changes,
                onWarning,
                pendingWorkletEvents
            );

            schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

            // Emit scheduling-done progress (40% of this stem's slot) before the render blocks
            const fractAfterSchedule = (done + 0.4) / eligible.length;
            onProgress?.(fractAfterSchedule);
            await yieldToMain();

            // Simulate progress during the black-box startRendering() call
            let stemSim = fractAfterSchedule;
            const stemTarget = (done + 1) / eligible.length;
            const stemTimer = onProgress
                ? setInterval(() => {
                      stemSim += (stemTarget * 0.97 - stemSim) * PROGRESS_EASE_COEFF;
                      onProgress(stemSim);
                  }, 100)
                : null;

            const buffer = await renderWithTimeout(offlineCtx).finally(() => {
                if (stemTimer !== null) clearInterval(stemTimer);
            });

            stems.set(track.id, buffer);
            done++;
            onProgress?.(done / eligible.length);
        }

        return stems;
    } finally {
        releaseLock();
    }
}
