import { getTrackStoreState } from '#/modules/Arrangement/useCases/getTrackStoreState';
import { getMidiStoreState } from '#/modules/MIDI/useCases/getMidiStoreState';
import { getAutomationLanes } from '#/modules/Automation/useCases/getAutomationLanes';
import { getTransportStoreValue, getTempoMapState } from '#/modules/Transport/useCases/transportQueries';
import { audioBufferCache } from '../stores/audioBufferCache';
import { buildDeviceChain } from './buildDeviceChain';
import { scheduleNoteOffline, getSynthParamsFromDevices } from '#/modules/Synth/useCases/builtinSynth';
import { scheduleKitNote } from '#/modules/Synth/useCases/drumKitSynth';
import { getDrumKitDefByIndex, scheduleDrumKitNote } from '#/modules/Synth/useCases/drumSynthEngine/kitDefinitions';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases/resolveComping';
import { beatToSeconds } from '#/modules/AudioEngine/services/beatConversion';
import { resolveDrumKit } from '#/modules/AudioEngine/services/deviceResolution';
import { scheduleTrackAutomation } from '../repositories/offlineScheduler/automationScheduling';

// Re-export encoders for consumers
export { audioBufferToWav } from '../repositories/audioEncoders/wavEncoder';
export { audioBufferToMp3 } from '../repositories/audioEncoders/mp3Encoder';
export { audioBufferToFlac } from '../repositories/audioEncoders/flacEncoder';

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
/** Minimum timeout floor regardless of project length. */
const MIN_RENDER_TIMEOUT_MS = 60_000;
/** Timeout multiplier: allow this many seconds of wall-clock time per second of audio. */
const RENDER_TIMEOUT_MULTIPLIER = 10;
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

type OfflineTrackStrip = {
    inputNode: GainNode;
    preFaderTap: GainNode;
    faderNode: GainNode;
    postFaderGain: GainNode;
    panNode: StereoPannerNode;
    outputNode: GainNode;
    deviceEntries: import('./buildDeviceChain').DeviceNodeEntry[];
};

type OfflineBusStrip = {
    gainNode: GainNode;
};

function hasToasterDevice(
    track: ReturnType<typeof getTrackStoreState> extends { tracks: (infer T)[] } | null ? T : never
): boolean {
    return track.devices.some((device) => device.type === 'toaster');
}

function shouldCreateOfflineStrip(
    track: ReturnType<typeof getTrackStoreState> extends { tracks: (infer T)[] } | null ? T : never
): boolean {
    return track.kind !== 'folder' || hasToasterDevice(track);
}

async function createOfflineTrackStrip(
    offlineCtx: OfflineAudioContext,
    track: ReturnType<typeof getTrackStoreState> extends { tracks: (infer T)[] } | null ? T : never
): Promise<OfflineTrackStrip> {
    const inputNode = offlineCtx.createGain();
    inputNode.gain.value = 1;

    const preFaderTap = offlineCtx.createGain();
    preFaderTap.gain.value = 1;

    const faderNode = offlineCtx.createGain();
    faderNode.gain.value = Math.max(0, track.gain);

    const postFaderGain = offlineCtx.createGain();
    postFaderGain.gain.value = track.muted ? 0 : 1;

    const panNode = offlineCtx.createStereoPanner();
    panNode.pan.value = Math.max(-1, Math.min(1, track.pan / 50));

    const outputNode = offlineCtx.createGain();
    outputNode.gain.value = 1;

    const deviceEntries = await buildDeviceChain(offlineCtx, track.devices, inputNode, preFaderTap);

    preFaderTap.connect(faderNode);
    faderNode.connect(postFaderGain);
    postFaderGain.connect(panNode);
    panNode.connect(outputNode);

    return {
        inputNode,
        preFaderTap,
        faderNode,
        postFaderGain,
        panNode,
        outputNode,
        deviceEntries,
    };
}

function createOfflineBusStrip(offlineCtx: OfflineAudioContext, trackGain: number, masterGain: GainNode): OfflineBusStrip {
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = Math.max(0, Math.min(2, trackGain));
    gainNode.connect(masterGain);
    return { gainNode };
}

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
    trackInputNode: GainNode,
    trackGainNode: GainNode,
    trackPanNode: StereoPannerNode,
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
        const frozenBuf = audioBufferCache.get(track.frozenBufferId);
        if (frozenBuf) {
            const source = offlineCtx.createBufferSource();
            source.buffer = frozenBuf;
            source.connect(trackInputNode);
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
    let deviceEntries: import('./buildDeviceChain').DeviceNodeEntry[];
    
    // Use pre-built device chain if provided (Pass 2 of mixdown), otherwise build it (Stems export)
    if (deviceEntriesByTrack && deviceEntriesByTrack.has(track.id)) {
        deviceEntries = deviceEntriesByTrack.get(track.id)!;
    } else {
        deviceEntries = await buildDeviceChain(offlineCtx, track.devices, trackInputNode, trackPanNode);
        trackPanNode.connect(destination);
    }

    scheduleTrackAutomation(
        automationLanes,
        track.id,
        trackGainNode,
        trackPanNode,
        deviceEntries,
        durationSeconds,
        defaultTempo,
        changes
    );

    let clipsToProcess: { clip: import('#/modules/Arrangement/models/Track').Clip; padIndex: number }[] = [];
    clipsToProcess.push(...resolveClipsWithComping(track.id, track.clips).map(c => ({ clip: c, padIndex: -1 })));

    let instrumentEntry = deviceEntries.find((e) => e.instrumentControls);
    let instrumentControls = instrumentEntry?.instrumentControls ?? null;
    let isToaster = instrumentEntry?.deviceType === 'toaster';

    // If this is a Toaster track, gather all clips from its child tracks.
    if (isToaster && allTracks) {
        const children = allTracks.filter((t) => t.parentId === track.id);
        for (let i = 0; i < children.length; i++) {
            const childTrack = children[i];
            if (!childTrack) continue;
            const childClips = resolveClipsWithComping(childTrack.id, childTrack.clips);
            clipsToProcess.push(...childClips.map((c) => ({ clip: c, padIndex: i })));
        }
    }

    for (const { clip, padIndex: toasterPadIndex } of clipsToProcess) {
        // Skip muted clips — they should not render audio
        if (clip.muted) {
            continue;
        }

        const clipVisualLength = clip.endBeat - clip.startBeat;
        // Skip degenerate clips (endBeat <= startBeat or zero-length)
        if (clipVisualLength <= 0) {
            onWarning?.(`Clip "${clip.name || clip.id}" on track "${track.name}" has zero or negative duration and was skipped.`);
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

            // Only Toaster parent tracks play their own children's clips.
            // If this is a child track of a Toaster, we skip processing its notes
            // here because the parent track will gather them and process them.
            if (!instrumentControls && track.parentId && allTracks) {
                const parentTrack = allTracks.find((t) => t.id === track.parentId);
                if (parentTrack?.devices.some((d) => d.type === 'toaster')) {
                    continue; // Let the parent track handle these notes
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
                        scheduleDrumKitNote(offlineCtx, trackInputNode, kitDef, note.pitch, startTime, note.velocity);
                    } else if (drumKit) {
                        scheduleKitNote(offlineCtx, trackInputNode, drumKit, note.pitch, startTime, duration, note.velocity);
                    } else {
                        scheduleNoteOffline(
                            offlineCtx,
                            trackInputNode,
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
                fadeGain.connect(trackInputNode);

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
function renderWithTimeout(offlineCtx: OfflineAudioContext, timeoutMs: number): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Offline render timed out after ${timeoutMs / 1000}s`));
        }, timeoutMs);

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
        // We MUST include folder tracks if they contain a Toaster device, because
        // child tracks send MIDI to the parent Toaster device to generate audio.
        const allRenderableTracks =
            tracks && midi
                ? tracks.tracks.filter((track) => !track.disabled && shouldCreateOfflineStrip(track))
                : [];
        const sourceTracks = allRenderableTracks.filter((track) => !track.muted);
        let scheduled = 0;
        const pendingWorkletEvents: PendingWorkletEvent[] = [];

        // Build the same strip topology the live engine uses:
        // Track input -> devices -> pre-fader tap -> fader -> mute -> pan -> output routing.
        // Sends tap either pre-fader or post-pan, and buses sum into the master gain.
        const trackStripsById = new Map<string, OfflineTrackStrip>();
        const deviceEntriesByTrack = new Map<string, import('./buildDeviceChain').DeviceNodeEntry[]>();
        const busStripsById = new Map<string, OfflineBusStrip>();

        for (const track of allRenderableTracks) {
            checkCancel();

            if (track.kind === 'bus') {
                busStripsById.set(track.id, createOfflineBusStrip(offlineCtx, track.gain, masterGain));
            }
        }

        for (const track of allRenderableTracks) {
            checkCancel();
            const strip = await createOfflineTrackStrip(offlineCtx, track);
            trackStripsById.set(track.id, strip);
            deviceEntriesByTrack.set(track.id, strip.deviceEntries);
        }

        for (const track of allRenderableTracks) {
            const strip = trackStripsById.get(track.id);
            if (!strip) {
                continue;
            }

            if (track.outputId === 'hw_out' || !track.outputId) {
                strip.outputNode.connect(masterGain);
            } else {
                const busStrip = busStripsById.get(track.outputId);
                const targetTrackStrip = trackStripsById.get(track.outputId);
                if (busStrip) {
                    strip.outputNode.connect(busStrip.gainNode);
                } else if (targetTrackStrip) {
                    strip.outputNode.connect(targetTrackStrip.inputNode);
                } else {
                    strip.outputNode.connect(masterGain);
                }
            }

            for (const send of track.sends) {
                const busStrip = busStripsById.get(send.busId);
                if (!busStrip) {
                    continue;
                }
                const sendGain = offlineCtx.createGain();
                sendGain.gain.value = Math.max(0, Math.min(1, send.level));
                const tapNode = send.preFader ? strip.preFaderTap : strip.outputNode;
                tapNode.connect(sendGain);
                sendGain.connect(busStrip.gainNode);
            }
        }

        // Schedule only audible source tracks, but keep the full routing graph alive so
        // buses, targets, and the master strip behave like live playback.
        for (const track of sourceTracks) {
            checkCancel();

            const strip = trackStripsById.get(track.id);
            if (!strip) {
                continue;
            }

            await scheduleTrackClips(
                offlineCtx,
                track,
                midi!,
                strip.inputNode,
                strip.faderNode,
                strip.panNode,
                masterGain,
                durationSeconds,
                defaultTempo,
                changes,
                onWarning,
                pendingWorkletEvents,
                sourceTracks,
                deviceEntriesByTrack
            );

            scheduled++;
            onProgress?.((scheduled / Math.max(1, sourceTracks.length)) * 0.5); // scheduling = 0-50%
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
        const schedulingFrac = sourceTracks.length > 0 ? 0.5 : 0;
        let simFrac = schedulingFrac;
        const renderTimer = onProgress
            ? setInterval(() => {
                  simFrac += (0.97 - simFrac) * PROGRESS_EASE_COEFF;
                  onProgress(simFrac);
              }, 100)
            : null;

        const renderTimeoutMs = Math.max(MIN_RENDER_TIMEOUT_MS, durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000);
        const buffer = await renderWithTimeout(offlineCtx, renderTimeoutMs).finally(() => {
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

        // Exclude disabled and structural tracks (unless they host a Toaster); muted tracks are included as stems
        // (users may want silent-in-mixdown stems for later use in a DAW).
        const eligible = tracks.tracks.filter(
            (t) => !t.disabled && t.kind !== 'master' && (t.kind !== 'folder' || t.devices.some((d) => d.type === 'toaster'))
        );
        let done = 0;

        // Edge case: no eligible tracks — still complete progress
        if (eligible.length === 0) {
            onProgress?.(1);
            return stems;
        }

        const frameCount = Math.min(Math.ceil(durationSeconds * sampleRate), MAX_OFFLINE_FRAMES);
        // Dynamically scale CPU threads based on hardware, clamped to 8 max to prevent OOM
        const MAX_CONCURRENT_RENDERS = typeof navigator !== 'undefined' 
            ? Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8)) 
            : 4;

        const tasks = eligible.map((track) => async () => {
            checkCancel();

            const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);
            const trackGain = offlineCtx.createGain();
            trackGain.gain.value = Math.max(0, track.gain);
            const trackPan = offlineCtx.createStereoPanner();
            // Mirror TrackNode.setPan: pan is -100..100, StereoPanner expects -1..1
            trackPan.pan.value = Math.max(-1, Math.min(1, track.pan / 50));

            const pendingWorkletEvents: PendingWorkletEvent[] = [];
            const strip = await createOfflineTrackStrip(offlineCtx, track);
            const deviceEntriesByTrack = new Map<string, import('./buildDeviceChain').DeviceNodeEntry[]>();
            deviceEntriesByTrack.set(track.id, strip.deviceEntries);
            strip.outputNode.connect(offlineCtx.destination);

            await scheduleTrackClips(
                offlineCtx,
                track,
                midi,
                strip.inputNode,
                strip.faderNode,
                strip.panNode,
                offlineCtx.destination,
                durationSeconds,
                defaultTempo,
                changes,
                onWarning,
                pendingWorkletEvents,
                [track],
                deviceEntriesByTrack
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

            const stemTimeoutMs = Math.max(MIN_RENDER_TIMEOUT_MS, durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000);
            const buffer = await renderWithTimeout(offlineCtx, stemTimeoutMs).finally(() => {
                if (stemTimer !== null) clearInterval(stemTimer);
            });

            stems.set(track.id, buffer);
            done++;
            onProgress?.(done / eligible.length);
        });

        // Run exports concurrently up to the thread limit
        let activeTasks = 0;
        let taskIndex = 0;
        
        await new Promise<void>((resolve, reject) => {
            const next = () => {
                if (cancelFlag) {
                    reject(new Error('Export cancelled'));
                    return;
                }
                while (activeTasks < MAX_CONCURRENT_RENDERS && taskIndex < tasks.length) {
                    const task = tasks[taskIndex++];
                    activeTasks++;
                    task!()
                        .then(() => {
                            activeTasks--;
                            if (taskIndex >= tasks.length && activeTasks === 0) resolve();
                            else next();
                        })
                        .catch(reject);
                }
                if (taskIndex >= tasks.length && activeTasks === 0) resolve();
            };
            next();
        });

        return stems;
    } finally {
        releaseLock();
    }
}
