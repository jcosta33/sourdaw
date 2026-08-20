import { deriveVcaMultiplier, getVcaGroupsState, type Track } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { connectOfflineSidechainRoutes } from '../../repositories/offlineRouting/connectOfflineSidechainRoutes';
import { type DeviceNodeEntry } from '../buildDeviceChain';
import { getAudioContext } from '../engineAccess/getAudioContext';
import { getSidechainKeyDelay } from '../latencyCompensation/compensation/getSidechainKeyDelay';

import { clampRenderFrameCount } from './clampRenderFrameCount';
import { collectDeviceRuntimeFailures } from './collectDeviceRuntimeFailures';
import { connectOfflineToasterPadRoutes } from './connectOfflineToasterPadRoutes';
import { MIN_RENDER_TIMEOUT_MS, RENDER_TIMEOUT_MULTIPLIER } from './constants';
import { createOfflineTrackStrip } from './createOfflineTrackStrip';
import { cropHistoryFromRenderedBuffer } from './cropHistoryFromRenderedBuffer';
import { destroyOfflineDeviceStrategies } from './destroyOfflineDeviceStrategies';
import { prepareOfflineContext } from './prepareOfflineContext';
import { projectStripTrack, type TargetMixerDisposition } from './projectStripTrack';
import { renderInSegments } from './renderInSegments';
import { resolveHistoryAwareRenderContext } from './resolveHistoryAwareRenderContext';
import { schedulePendingSuspends } from './schedulePendingSuspends';
import { scheduleTrackClips } from './scheduleTrackClips';
import { type OfflineScheduleTally, type OfflineTrackStrip, type PendingWorkletEvent } from './types';
import { yieldToMain } from './yieldToMain';

/** Stand-in note tables for a render started before the MIDI store is hydrated. */
const EMPTY_MIDI_STATE = {
    probabilitySeed: 0,
    notesByClipId: {},
    ccByClipId: {},
    pitchBendByClipId: {},
} as const;

export type ResolveContributorVcaMultiplierInput = {
    track: Track;
    isTarget: boolean;
    groups: ReturnType<typeof getVcaGroupsState>;
};

/**
 * The VCA group master to bake into one track of this render — and the one place
 * the two halves of this subgraph are deliberately treated differently.
 *
 * **Upstream contributors get it.** Their audio is summed into the print exactly
 * once and is never recomposed afterwards: the routing edge that got baked stops
 * carrying live signal the moment the target is frozen, so whatever their group
 * master was worth has to be in the samples or it is lost for good.
 *
 * **The target does not.** Its strip stays live after the freeze, and
 * `applyVcaGains` / the gain-automation branch keep driving that same fader.
 * Baking the multiplier in here would apply the group twice, once in the buffer
 * and again on the fader the buffer is replayed through.
 *
 * Two rules in one loop, so it is stated here rather than left to be inferred.
 */
function resolveContributorVcaMultiplier({ track, isTarget, groups }: ResolveContributorVcaMultiplierInput): number {
    if (isTarget) {
        return 1;
    }

    return deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups });
}

type RenderTrackSubgraphOfflineInput = {
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
    /**
     * Whether the target track's own fader and panner belong in the print.
     *
     * Defaults to `'bake'`, which is right for every caller whose output is
     * finished audio. Freeze passes `'keepLive'`: its buffer is replayed through
     * that very strip, so baking those values applies them twice. See
     * `projectStripTrack` for the rule.
     */
    targetMixer?: TargetMixerDisposition;
    onProgress?: (fraction: number) => void;
    onWarning?: (message: string) => void;
    /**
     * Reports what the scheduler actually put into the graph, once scheduling
     * is complete and before the render runs. Every track of the subgraph feeds
     * one tally: they all sum into the target's output, so the target being
     * silent while *anything* upstream was scheduled is the interesting case.
     */
    onScheduled?: (tally: OfflineScheduleTally) => void;
    abortSignal?: AbortSignal;
};

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
    targetMixer = 'bake',
    onProgress,
    onWarning,
    onScheduled,
    abortSignal,
}: RenderTrackSubgraphOfflineInput): Promise<AudioBuffer | null> {
    const durationBeats = endBeat - startBeat;
    if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
        return null;
    }

    const sampleRate = getAudioContext().sampleRate;
    const { renderContext, historySeconds, outputDurationSeconds } = resolveHistoryAwareRenderContext({
        durationBeats,
        startBeat,
        tailSeconds,
        sampleRate,
    });
    const { midi, defaultTempo, changes, durationSeconds, ...projections } = renderContext;
    const { projectMidiEvents, projectPpqEndpoints, selectMidiEventProbability, projectChordPitch } = projections;
    if (!projectMidiEvents || !projectPpqEndpoints || !selectMidiEventProbability || !projectChordPitch) {
        throw new Error('Offline musical projection is not configured');
    }

    // Shared with the mixdown and the stem path so an over-long freeze is
    // *reported* rather than silently producing a short buffer that looks like a
    // success. This used to re-inline the `Math.min`, which is the same clamp
    // with no warning channel — and `onWarning` was already in scope.
    const frameCount = clampRenderFrameCount({ durationSeconds, sampleRate, onWarning });
    if (frameCount <= 0) {
        return null;
    }
    const offlineCtx = new OfflineAudioContext(2, frameCount, sampleRate);

    const sidechainRoutes = sidechainStore.value?.routes ?? [];

    // Before any strip exists. Both out-of-band devices build their worklet node
    // synchronously inside `createOfflineTrackStrip`, so a module registered
    // afterwards is registered too late and the device degrades silently.
    const renderTrackIds = new Set(renderTracks.map((track) => track.id));
    const keyedSidechainDevices = new Set<object>();
    for (const route of sidechainRoutes) {
        if (!renderTrackIds.has(route.sourceTrackId)) {
            continue;
        }
        const targetTrack = renderTracks.find((track) => track.id === route.targetTrackId);
        const targetDevice = targetTrack?.devices.find(
            (device) => device.id === route.targetDeviceId && !device.bypassed
        );
        if (targetDevice?.type === 'builtin-sidechain-compressor') {
            keyedSidechainDevices.add(targetDevice);
        }
    }
    await prepareOfflineContext({
        offlineCtx,
        tracks: renderTracks,
        sidechainTargetDevices: keyedSidechainDevices,
        onWarning,
    });

    // Snapshot once: every strip and every gain lane in this render must see the
    // same group levels, however long the render takes.
    const vcaGroups = getVcaGroupsState();

    const trackStripsById = new Map<string, OfflineTrackStrip>();
    const deviceEntriesByTrack = new Map<string, DeviceNodeEntry[]>();
    // Everything from the first strip on is inside the teardown's scope. Every
    // metered native device takes a telemetry slot at construction and only
    // `destroy()` gives it back, so a render that times out, faults or is
    // cancelled has to release exactly what a successful one does — hence a
    // `finally` rather than a line after the returned buffer.
    try {
        for (const track of renderTracks) {
            const strip = await createOfflineTrackStrip(
                offlineCtx,
                projectStripTrack({
                    track,
                    isTarget: track.id === targetTrackId,
                    includeInserts,
                    includeAutomation,
                    targetMixer,
                }),
                // Freeze and bounce produce deliverable audio, not a monitoring
                // snapshot — the same reason exportStems opts out. Baking mute in
                // would hand back a zeroed buffer, and bounce-to-new-track then
                // shows that silent waveform on an unmuted track. The renderer this
                // replaced never consulted `muted` at all.
                //
                // The VCA multiplier is per-track and asymmetric here; see
                // `resolveContributorVcaMultiplier` for why the target is the one
                // track that does not get it.
                {
                    honorMuted: false,
                    vcaMultiplier: resolveContributorVcaMultiplier({
                        track,
                        isTarget: track.id === targetTrackId,
                        groups: vcaGroups,
                    }),
                    onWarning,
                }
            );
            trackStripsById.set(track.id, strip);
            deviceEntriesByTrack.set(track.id, strip.deviceEntries);
        }

        connectOfflineToasterPadRoutes({ tracks: renderTracks, trackStripsById, deviceEntriesByTrack });

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
        const tally: OfflineScheduleTally = { scheduledNotes: 0, scheduledBuffers: [] };
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
                    resolveTempoAtBeat: projections.resolveTempoAtBeat,
                    processYeastMidi: projections.processYeastMidi,
                    selectMidiEventProbability,
                    projectChordPitch,
                    evaluateAutomationValue: projections.evaluateAutomationValue,
                    resolveArticulationId: projections.resolveArticulationId,
                },
                onWarning,
                pendingWorkletEvents,
                allTracks: renderTracks,
                deviceEntriesByTrack,
                honorMuted: false,
                regionStartBeat: 0,
                tallyStartSeconds: historySeconds,
                includeAutomation: track.id === targetTrackId ? includeAutomation : true,
                // Same rule as the strip seed: a `gain` or `pan` lane drives the very
                // nodes the frozen buffer is replayed through, and live
                // `applyAutomation` keeps driving them after the freeze, so baking
                // those lanes doubles them exactly as the static values were.
                // Device lanes are untouched — the chain is bypassed at replay, so
                // their moves exist only if they are in the samples.
                includeMixerAutomation: !(track.id === targetTrackId && targetMixer === 'keepLive'),
                // Same rule the strip was seeded with, so a gain lane on an upstream
                // contributor rides its group instead of nullifying it.
                vcaMultiplier: resolveContributorVcaMultiplier({
                    track,
                    isTarget: track.id === targetTrackId,
                    groups: vcaGroups,
                }),
                tally,
                abortSignal,
            });
        }

        onScheduled?.(tally);

        schedulePendingSuspends(offlineCtx, pendingWorkletEvents, durationSeconds);

        await yieldToMain();

        if (abortSignal?.aborted) {
            throw new Error('Render aborted');
        }

        // The same segmented kernel the mixdown and stem exports use, rather than a
        // second copy of it. Two things this path did not have before: a wall-clock
        // backstop, so a wedged freeze can no longer hang indefinitely, and teardown
        // of the context it abandons.
        //
        // The stop signal is this render's own `AbortSignal`, deliberately not the
        // global export cancel flag — cancelling an export must not kill a freeze.
        const renderTimeoutMs = Math.max(MIN_RENDER_TIMEOUT_MS, durationSeconds * RENDER_TIMEOUT_MULTIPLIER * 1000);
        const buffer = await renderInSegments({
            offlineCtx,
            durationSeconds,
            timeoutMs: renderTimeoutMs,
            ...collectDeviceRuntimeFailures(deviceEntriesByTrack),
            onRenderProgress: onProgress,
            cancelSource: {
                isCancelled: () => abortSignal?.aborted ?? false,
                createCancelError: () => new Error('Render aborted'),
            },
        });

        onProgress?.(1);
        return cropHistoryFromRenderedBuffer({ buffer, historySeconds, outputDurationSeconds });
    } finally {
        destroyOfflineDeviceStrategies(deviceEntriesByTrack);
    }
}
