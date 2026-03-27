import { getTrackStoreState, getMidiStoreState, getAutomationLanes } from '#/modules/Arrangement/useCases/trackQueries';
import { getTransportStoreValue, getTempoMapState } from '#/modules/Transport/useCases/transportQueries';
import { audioBufferCache } from '../stores/audioBufferCache';
import { buildDeviceChain } from './buildDeviceChain';
import { scheduleNoteOffline, getSynthParamsForTrack } from '#/modules/Synth/useCases/builtinSynth';
import { scheduleKitNote } from '#/modules/Synth/useCases/drumKitSynth';
import { getDrumKitDefByIndex, scheduleDrumKitNote } from '#/modules/Synth/useCases/drumSynthEngine';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases/resolveComping';
import { beatToSeconds, resolveDrumKit, scheduleTrackAutomation } from '../repositories/offlineScheduler';

// Re-export encoders for consumers
export { audioBufferToWav, downloadWav, downloadMp3, downloadFlac } from '../repositories/audioEncoders';

// ── Cancel token ─────────────────────────────────────────────────────
let cancelFlag = false;

export function cancelExport(): void {
    cancelFlag = true;
}

function checkCancel(): void {
    if (cancelFlag) {
        throw new Error('Export cancelled');
    }
}

// ── Export options ────────────────────────────────────────────────────
export type OfflineRenderOptions = {
    durationBeats: number;
    sampleRate?: number;
    onProgress?: (fraction: number) => void;
};

const MICRO_FADE_SECONDS = 0.003;
const RENDER_TIMEOUT_MS = 300_000; // 5 min timeout for large projects
const YIELD_EVERY_N_NOTES = 200; // yield to main thread every N notes

/** Yield to the main thread so the UI can update. */
function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Schedule a single track's clips into the given OfflineAudioContext.
 * Shared between mixdown and stem paths to avoid duplication.
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
    changes: ReturnType<typeof getTempoMapState> extends { changes: infer C } | null ? C : never
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
        const clipVisualLength = clip.endBeat - clip.startBeat;
        const loopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
        const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;

        if (clip.type === 'midi') {
            const notes = midi.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            const drumKit = resolveDrumKit(track.devices);
            const kitDef = getDrumKitDefByIndex(
                track.devices.find((d) => d.type === 'builtin-drum-kit' || d.type === 'drum-kit')?.parameterValues
                    .kit ?? 0
            );
            const synthParams = drumKit || kitDef ? null : getSynthParamsForTrack(track.id);
            let noteCount = 0;

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

                    if (kitDef) {
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
        } else if (clip.type === 'audio' && clip.audioBufferId) {
            const buffer = audioBufferCache.get(clip.audioBufferId);
            if (!buffer) {
                continue;
            }

            const stretchRatio = clip.stretchMode && clip.stretchMode !== 'off' ? (clip.stretchRatio ?? 1) : 1;

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
                const needsMicroFadeIn = isFirstIter && clip.fadeInBeats === 0;
                const needsMicroFadeOut = isLastIter && clip.fadeOutBeats === 0;

                const remainingBeats = Math.min(loopLen, clip.endBeat - iterStartBeat);
                const iterEndTime = beatToSeconds(iterStartBeat + remainingBeats, defaultTempo, changes);
                const iterDurationSec = iterEndTime - iterStartTime;
                const playDuration = Math.min(iterDurationSec, buffer.duration / stretchRatio);

                const source = offlineCtx.createBufferSource();
                source.buffer = buffer;
                if (stretchRatio !== 1) {
                    source.playbackRate.value = stretchRatio;
                }

                const startSec = Math.max(0, iterStartTime);

                if (needsMicroFadeIn || needsMicroFadeOut) {
                    const fadeGain = offlineCtx.createGain();
                    source.connect(fadeGain);
                    fadeGain.connect(trackGain);

                    if (needsMicroFadeIn) {
                        fadeGain.gain.setValueAtTime(0, startSec);
                        fadeGain.gain.linearRampToValueAtTime(1, startSec + MICRO_FADE_SECONDS);
                    } else {
                        fadeGain.gain.setValueAtTime(1, startSec);
                    }

                    if (needsMicroFadeOut) {
                        const endSec = startSec + playDuration;
                        fadeGain.gain.setValueAtTime(1, Math.max(startSec, endSec - MICRO_FADE_SECONDS));
                        fadeGain.gain.linearRampToValueAtTime(0, endSec);
                    }
                } else {
                    source.connect(trackGain);
                }

                source.start(startSec, 0, playDuration * stretchRatio);
            }
        }
    }
}

/**
 * Render the full mixdown using OfflineAudioContext.
 * Wraps startRendering() with a timeout to catch stuck renders.
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
    cancelFlag = false;

    const durationBeats = typeof optsOrBeats === 'number' ? optsOrBeats : optsOrBeats.durationBeats;
    const sampleRate = typeof optsOrBeats === 'number' ? (maybeSampleRate ?? 44100) : (optsOrBeats.sampleRate ?? 44100);
    const onProgress = typeof optsOrBeats === 'object' ? optsOrBeats.onProgress : undefined;

    const transport = getTransportStoreValue();
    const tracks = getTrackStoreState();
    const midi = getMidiStoreState();
    const tempoMap = getTempoMapState();
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];
    const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);

    const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(offlineCtx.destination);

    if (tracks && midi) {
        const eligible = tracks.tracks.filter((t) => !t.muted && t.kind !== 'folder');
        let scheduled = 0;

        for (const track of eligible) {
            checkCancel();

            const trackGain = offlineCtx.createGain();
            trackGain.gain.value = track.gain;
            const trackPan = offlineCtx.createStereoPanner();
            trackPan.pan.value = track.pan / 50;

            await scheduleTrackClips(
                offlineCtx,
                track,
                midi,
                trackGain,
                trackPan,
                masterGain,
                durationSeconds,
                defaultTempo,
                changes
            );

            scheduled++;
            onProgress?.((scheduled / eligible.length) * 0.5); // scheduling = 0-50%
        }
    }

    checkCancel();
    onProgress?.(0.5);

    // Yield before rendering so the progress UI can update
    await yieldToMain();

    const buffer = await renderWithTimeout(offlineCtx);

    onProgress?.(1);
    return buffer;
}

export async function exportStems(opts: OfflineRenderOptions): Promise<Map<string, AudioBuffer>>;
export async function exportStems(durationBeats: number, sampleRate?: number): Promise<Map<string, AudioBuffer>>;
export async function exportStems(
    optsOrBeats: OfflineRenderOptions | number,
    maybeSampleRate?: number
): Promise<Map<string, AudioBuffer>> {
    cancelFlag = false;

    const durationBeats = typeof optsOrBeats === 'number' ? optsOrBeats : optsOrBeats.durationBeats;
    const sampleRate = typeof optsOrBeats === 'number' ? (maybeSampleRate ?? 44100) : (optsOrBeats.sampleRate ?? 44100);
    const onProgress = typeof optsOrBeats === 'object' ? optsOrBeats.onProgress : undefined;

    const tracks = getTrackStoreState();
    const midi = getMidiStoreState();
    const transport = getTransportStoreValue();
    const tempoMap = getTempoMapState();
    const defaultTempo = transport?.tempo ?? 120;
    const changes = tempoMap?.changes ?? [];
    const durationSeconds = beatToSeconds(durationBeats, defaultTempo, changes);
    const stems = new Map<string, AudioBuffer>();

    if (!tracks || !midi) {
        return stems;
    }

    const eligible = tracks.tracks.filter((t) => t.kind !== 'folder' && t.kind !== 'master');
    let done = 0;

    for (const track of eligible) {
        checkCancel();

        const offlineCtx = new OfflineAudioContext(2, Math.ceil(durationSeconds * sampleRate), sampleRate);
        const trackGain = offlineCtx.createGain();
        trackGain.gain.value = track.gain;
        const trackPan = offlineCtx.createStereoPanner();
        trackPan.pan.value = track.pan / 50;

        await scheduleTrackClips(
            offlineCtx,
            track,
            midi,
            trackGain,
            trackPan,
            offlineCtx.destination,
            durationSeconds,
            defaultTempo,
            changes
        );

        const buffer = await renderWithTimeout(offlineCtx);
        stems.set(track.id, buffer);

        done++;
        onProgress?.(done / eligible.length);
    }

    return stems;
}
