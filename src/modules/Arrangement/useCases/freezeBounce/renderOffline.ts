import { renderTrackSubgraphOffline } from '#/modules/AudioEngine/useCases';
import { sidechainStore } from '#/modules/Routing/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type Track } from '../../models/Track';
import { getUpstreamSubgraph } from '../../services/getUpstreamSubgraph';
import { getTrackEligibility } from '../../stores/trackEligibility';
import { trackStore } from '../../stores/trackStore';

/** Seconds of extra render an auto-tail bounce gets before the silence trim. */
const AUTO_TAIL_SECONDS = 10;

/** Default warning sink: this buffer is persisted, so the user has to be told. */
function reportDroppedDeviceToUser(message: string): void {
    notifyUser(message, 'warning');
}

/**
 * What the offline scheduler actually put into the graph for this render.
 *
 * Derived from the engine's own signature rather than restated, so the two
 * cannot drift; use-case barrels do not re-export types across modules.
 */
export type RenderScheduleTally = Parameters<
    NonNullable<Parameters<typeof renderTrackSubgraphOffline>[0]['onScheduled']>
>[0];

export type RenderOfflineOptions = {
    onProgress?: (progress: number) => void;
    /**
     * Receives the scheduler's own account of what reached the graph. The
     * silence guard reads it instead of predicting what *should* have been
     * scheduled — see `detectSilentBake`.
     */
    onScheduled?: (tally: RenderScheduleTally) => void;
    abortSignal?: AbortSignal;
    includeInserts?: boolean;
    includeSends?: boolean;
    includeAutomation?: boolean;
    normalization?: 'off' | 'protection' | 'full';
    autoTail?: boolean;
    /**
     * Seconds of tail to render past the region, for a caller that has already
     * worked out how long its chain rings. Ignored when `autoTail` is set, which
     * is the bounce path's own fixed reservation plus a silence trim.
     *
     * Freeze passes this. Expressing the tail in *seconds* rather than beats
     * bolted onto `endBeat` is load-bearing: a beat count shortens as the
     * session's tempo rises, so the same reverb was cut progressively harder the
     * faster the project ran.
     */
    tailSeconds?: number;
    /**
     * Whether the target track's own fader and panner belong in the rendered
     * buffer. Freeze passes `'keepLive'` because its buffer is replayed through
     * that very strip; every other caller's output is finished audio.
     */
    targetMixer?: 'bake' | 'keepLive';
    /**
     * Where a dropped-device warning from the offline chain goes. Defaults to
     * the user-facing notification channel, and that default is the point.
     *
     * This output is *persisted* — a frozen buffer replaces the track's live
     * sound, and a bounced buffer becomes a project clip that later enters
     * exports — so a device the chain could not build is baked in as a
     * permanent absence. Freezing a track carrying a third-party plugin, which
     * is hosted live in the desktop app, writes a buffer without it. Every export path
     * routes this to the user; before this default, freeze and bounce sent it
     * to `logger.warn` and stopped, because `renderTrackSubgraphOffline` took
     * an `onWarning` no caller here could supply.
     *
     * Pass an explicit handler to collect instead of notify.
     */
    onWarning?: (message: string) => void;
};

/**
 * Render a single track's region offline for freeze and bounce.
 *
 * The render runs through the AudioEngine's real offline graph
 * (`renderTrackSubgraphOffline`) — the same strips, device chains and
 * instrument nodes live playback uses. This use case owns only what belongs to
 * Arrangement: which tracks make up the render subgraph, and the
 * post-processing (tail trim, normalization) freeze and bounce ask for.
 *
 * MD-4: this path previously synthesised every MIDI instrument as a fixed
 * triangle oscillator, and its output is deliverable audio — frozen buffers
 * play back in place of the instrument and bounced buffers become project
 * clips that enter exports.
 */
export async function renderTrackOffline(
    targetTrack: Track,
    startBeat: number,
    endBeat: number,
    options?: RenderOfflineOptions
): Promise<AudioBuffer | null> {
    const eligibility = getTrackEligibility(targetTrack.kind);
    if (!eligibility.acceptsClipAdd) {
        return null;
    }

    // Only audio and midi tracks produce renderable content on their own.
    // Bus / group / master tracks have no direct sound source — skip rendering.
    if (!eligibility.rendersTrackContent) {
        return null;
    }

    const allTracks = trackStore.value?.tracks ?? [];
    const upstreamIds = getUpstreamSubgraph(targetTrack.id, allTracks, sidechainStore.value?.routes ?? []);
    const renderTracks: Track[] = [];
    for (const candidate of allTracks) {
        const belongsToRenderSubgraph = candidate.id === targetTrack.id || upstreamIds.has(candidate.id);
        if (!belongsToRenderSubgraph) {
            continue;
        }
        if (!getTrackEligibility(candidate.kind).acceptsRoutingEndpoint) {
            continue;
        }
        renderTracks.push(candidate);
    }
    if (!renderTracks.some((candidate) => candidate.id === targetTrack.id)) {
        renderTracks.unshift(targetTrack);
    }

    const buffer = await renderTrackSubgraphOffline({
        targetTrackId: targetTrack.id,
        renderTracks,
        startBeat,
        endBeat,
        tailSeconds: options?.autoTail ? AUTO_TAIL_SECONDS : (options?.tailSeconds ?? 0),
        targetMixer: options?.targetMixer ?? 'bake',
        includeInserts: options?.includeInserts ?? true,
        includeAutomation: options?.includeAutomation ?? true,
        includeSends: options?.includeSends ?? true,
        onProgress: options?.onProgress,
        onScheduled: options?.onScheduled,
        onWarning: options?.onWarning ?? reportDroppedDeviceToUser,
        abortSignal: options?.abortSignal,
    });

    if (!buffer) {
        return null;
    }

    let finalBuffer = buffer;
    if (options?.autoTail) {
        finalBuffer = trimSilence(finalBuffer, -80);
    }

    if (options?.normalization && options.normalization !== 'off') {
        finalBuffer = normalizeBuffer(finalBuffer, options.normalization);
    }

    return finalBuffer;
}

function trimSilence(buffer: AudioBuffer, thresholdDb: number): AudioBuffer {
    const threshold = 10 ** (thresholdDb / 20);
    const sampleRate = buffer.sampleRate;
    const channels = buffer.numberOfChannels;
    const length = buffer.length;

    let lastActiveSample = 0;

    for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let index = length - 1; index >= lastActiveSample; index--) {
            if (Math.abs(data[index]!) > threshold) {
                lastActiveSample = Math.max(lastActiveSample, index);
                break;
            }
        }
    }

    // Add 100ms safety buffer
    const safetySamples = Math.floor(sampleRate * 0.1);
    const finalLength = Math.min(length, lastActiveSample + safetySamples);

    if (finalLength === length) {
        return buffer;
    }

    const newBuffer = new AudioBuffer({
        length: finalLength,
        numberOfChannels: channels,
        sampleRate,
    });

    for (let ch = 0; ch < channels; ch++) {
        newBuffer.copyToChannel(buffer.getChannelData(ch).subarray(0, finalLength), ch);
    }

    return newBuffer;
}

function normalizeBuffer(buffer: AudioBuffer, mode: 'protection' | 'full'): AudioBuffer {
    const channels = buffer.numberOfChannels;
    const length = buffer.length;
    let maxPeak = 0;

    for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let index = 0; index < length; index++) {
            const abs = Math.abs(data[index]!);
            if (abs > maxPeak) {
                maxPeak = abs;
            }
        }
    }

    if (maxPeak === 0) {
        return buffer;
    }

    let targetPeak = 1.0;
    if (mode === 'protection') {
        if (maxPeak <= 1.0) {
            return buffer;
        } // Already safe
        targetPeak = 0.98; // Normalize down to -0.2dB
    } else if (mode === 'full') {
        targetPeak = 0.99; // Normalize up/down to -0.1dB
    }

    const ratio = targetPeak / maxPeak;

    const newBuffer = new AudioBuffer({
        length,
        numberOfChannels: channels,
        sampleRate: buffer.sampleRate,
    });

    for (let ch = 0; ch < channels; ch++) {
        const src = buffer.getChannelData(ch);
        const dest = new Float32Array(length);
        for (let index = 0; index < length; index++) {
            dest[index] = src[index]! * ratio;
        }
        newBuffer.copyToChannel(dest, ch);
    }

    return newBuffer;
}
