import { type Track } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { connectOfflineSidechainRoutes } from '../../repositories/offlineRouting/connectOfflineSidechainRoutes';
import { type DeviceNodeEntry } from '../buildDeviceChain';
import { getAudioContext } from '../engineAccess/getAudioContext';
import { getSidechainKeyDelay } from '../latencyCompensation/compensation/getSidechainKeyDelay';

import { connectOfflineToasterPadRoutes } from './connectOfflineToasterPadRoutes';
import { MAX_OFFLINE_FRAMES } from './constants';
import { createOfflineTrackStrip } from './createOfflineTrackStrip';
import { isOfflineInstrumentDevice } from './isOfflineInstrumentDevice';
import { resolveRenderContext } from './resolveRenderContext';
import { schedulePendingSuspends } from './schedulePendingSuspends';
import { scheduleTrackClips } from './scheduleTrackClips';
import { type OfflineTrackStrip, type PendingWorkletEvent } from './types';
import { yieldToMain } from './yieldToMain';

/** Fader/pan values a bounce uses when the caller asks for the take without mixer moves. */
const NEUTRAL_GAIN = 0.8;
const NEUTRAL_PAN = 0;

/** Progress reported once every rendered chunk of this many seconds. */
const PROGRESS_CHUNK_SECONDS = 2;

/** Stand-in note tables for a render started before the MIDI store is hydrated. */
const EMPTY_MIDI_STATE = {
    probabilitySeed: 0,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
} as const;

export type RenderTrackSubgraphOfflineInput = {
    /** Track whose strip output is captured into the returned buffer. */
    targetTrackId: string;
    /**
     * Target track plus its upstream routing subgraph, in project order. The
     * caller owns subgraph selection (Arrangement's routing rules); this use
     * case only renders what it is handed.
     */
    renderTracks: readonly Track[];
    startBeat: number;
    endBeat: number;
    /** Seconds appended after the region so reverb/delay tails ring out. */
    tailSeconds?: number;
    /** False keeps only the instrument devices on the target track. */
    includeInserts?: boolean;
    /** False renders the target at neutral fader/pan and skips its automation. */
    includeAutomation?: boolean;
    /** False drops the target track's bus sends from the render graph. */
    includeSends?: boolean;
    onProgress?: (fraction: number) => void;
    onWarning?: (message: string) => void;
    abortSignal?: AbortSignal;
};

type StripTrackInput = {
    track: Track;
    isTarget: boolean;
    includeInserts: boolean;
    includeAutomation: boolean;
};

/**
 * Shape the track the *strip* is built from. Only the target honours the
 * bounce options; upstream tracks always render as the session has them, since
 * their contribution is what the target's chain is fed.
 */
function projectStripTrack({ track, isTarget, includeInserts, includeAutomation }: StripTrackInput): Track {
    if (!isTarget) {
        return track;
    }

    let devices = track.devices;
    if (!includeInserts) {
        devices = track.devices.filter((device) => isOfflineInstrumentDevice(device.type));
    }

    if (includeAutomation) {
        return { ...track, devices };
    }
    return { ...track, devices, gain: NEUTRAL_GAIN, pan: NEUTRAL_PAN };
}

type RenderWithProgressInput = {
    offlineCtx: OfflineAudioContext;
    onProgress?: (fraction: number) => void;
    abortSignal?: AbortSignal;
};

function renderWithProgress({ offlineCtx, onProgress, abortSignal }: RenderWithProgressInput): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
        if (abortSignal?.aborted) {
            reject(new Error('Render aborted'));
            return;
        }

        function abortHandler(): void {
            reject(new Error('Render aborted'));
        }
        abortSignal?.addEventListener('abort', abortHandler);

        const totalFrames = offlineCtx.length;
        const chunkFrames = Math.max(1, Math.round(PROGRESS_CHUNK_SECONDS * offlineCtx.sampleRate));
        for (let frame = chunkFrames; frame < totalFrames; frame += chunkFrames) {
            const capturedFrame = frame;
            offlineCtx
                .suspend(capturedFrame / offlineCtx.sampleRate)
                .then(() => {
                    if (abortSignal?.aborted) {
                        return null;
                    }
                    onProgress?.(capturedFrame / totalFrames);
                    void offlineCtx.resume();
                    return null;
                })
                .catch((error: unknown) => {
                    reject(error instanceof Error ? error : new Error(String(error)));
                    return null;
                });
        }

        offlineCtx
            .startRendering()
            .then((buffer) => {
                abortSignal?.removeEventListener('abort', abortHandler);
                if (!abortSignal?.aborted) {
                    onProgress?.(1);
                    resolve(buffer);
                }
                return null;
            })
            .catch((error: unknown) => {
                abortSignal?.removeEventListener('abort', abortHandler);
                reject(error instanceof Error ? error : new Error(String(error)));
                return null;
            });
    });
}

/**
 * Render one track (plus everything routed into it) offline through the *real*
 * device graph — the same strip topology, instrument nodes and note scheduling
 * the live engine uses, in an `OfflineAudioContext`.
 *
 * This is the single offline render for freeze and bounce. Before MD-4 those
 * paths owned a parallel renderer that synthesised every MIDI instrument as a
 * fixed triangle oscillator, so frozen buffers and bounced clips — which are
 * deliverable audio, not previews — carried a caricature of the track instead
 * of its instrument.
 */
export async function renderTrackSubgraphOffline({
    targetTrackId,
    renderTracks,
    startBeat,
    endBeat,
    tailSeconds = 0,
    includeInserts = true,
    includeAutomation = true,
    includeSends = true,
    onProgress,
    onWarning,
    abortSignal,
}: RenderTrackSubgraphOfflineInput): Promise<AudioBuffer | null> {
    const durationBeats = endBeat - startBeat;
    if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
        return null;
    }

    const sampleRate = getAudioContext().sampleRate;
    const { midi, defaultTempo, changes, durationSeconds, ...projections } = resolveRenderContext({
        durationBeats,
        startBeat,
        tailSeconds,
        sampleRate,
    });
    const { projectMidiEvents, projectPpqEndpoints, selectMidiEventProbability, projectChordPitch } = projections;
    if (!projectMidiEvents || !projectPpqEndpoints || !selectMidiEventProbability || !projectChordPitch) {
        throw new Error('Offline musical projection is not configured');
    }

    const frameCount = Math.min(Math.ceil(durationSeconds * sampleRate), MAX_OFFLINE_FRAMES);
    if (frameCount <= 0) {
        return null;
    }
    const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);

    const trackStripsById = new Map<string, OfflineTrackStrip>();
    const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
    for (const track of renderTracks) {
        const strip = await createOfflineTrackStrip(
            offlineCtx,
            projectStripTrack({
                track,
                isTarget: track.id === targetTrackId,
                includeInserts,
                includeAutomation,
            }),
            // Freeze and bounce produce deliverable audio, not a monitoring
            // snapshot — the same reason exportStems opts out. Baking mute in
            // would hand back a zeroed buffer, and bounce-to-new-track then
            // shows that silent waveform on an unmuted track. The renderer this
            // replaced never consulted `muted` at all.
            { honorMuted: false }
        );
        trackStripsById.set(track.id, strip);
        deviceEntriesByTrack.set(track.id, strip.deviceEntries);
    }

    connectOfflineToasterPadRoutes({ tracks: renderTracks, trackStripsById, deviceEntriesByTrack });

    const sidechainRoutes = sidechainStore.value?.routes ?? [];
    connectOfflineSidechainRoutes({
        offlineCtx,
        routes: sidechainRoutes,
        trackStripsById,
        deviceEntriesByTrack,
        keyDelaySecFor: getSidechainKeyDelay,
    });

    for (const track of renderTracks) {
        const strip = trackStripsById.get(track.id);
        if (!strip) {
            continue;
        }

        if (track.id === targetTrackId) {
            strip.outputNode.connect(offlineCtx.destination);
        } else {
            const downstream = trackStripsById.get(track.outputId);
            if (downstream) {
                strip.outputNode.connect(downstream.inputNode);
            }
        }

        const sendsRendered = track.id === targetTrackId ? includeSends : true;
        if (!sendsRendered) {
            continue;
        }
        for (const send of track.sends) {
            const busStrip = trackStripsById.get(send.busId);
            if (!busStrip) {
                continue;
            }
            const sendGain = offlineCtx.createGain();
            sendGain.gain.value = Math.max(0, Math.min(1, send.level));
            const tapNode = send.preFader ? strip.preFaderTap : strip.outputNode;
            tapNode.connect(sendGain);
            sendGain.connect(busStrip.inputNode);
        }
    }

    // An audio-only freeze can run before any MIDI has been loaded; the
    // scheduler only reads note tables, so an empty one is the honest input.
    const midiState = midi ?? EMPTY_MIDI_STATE;
    const pendingWorkletEvents: PendingWorkletEvent[] = [];
    for (const track of renderTracks) {
        const strip = trackStripsById.get(track.id);
        if (!strip) {
            continue;
        }

        await scheduleTrackClips({
            offlineCtx,
            track,
            midi: midiState,
            trackInputNode: strip.inputNode,
            trackGainNode: strip.faderNode,
            trackPanNode: strip.panNode,
            destination: offlineCtx.destination,
            durationSeconds,
            defaultTempo,
            changes,
            projections: {
                projectMidiEvents,
                projectPpqEndpoints,
                processYeastMidi: projections.processYeastMidi,
                selectMidiEventProbability,
                projectChordPitch,
                evaluateAutomationValue: projections.evaluateAutomationValue,
            },
            onWarning,
            pendingWorkletEvents,
            allTracks: renderTracks,
            deviceEntriesByTrack,
            regionStartBeat: startBeat,
            includeAutomation: track.id === targetTrackId ? includeAutomation : true,
        });
    }

    schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

    await yieldToMain();

    return renderWithProgress({ offlineCtx, onProgress, abortSignal });
}
