import { deriveVcaMultiplier } from '#/modules/Arrangement/stores';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { clampRenderFrameCount, MAX_OFFLINE_FRAMES } from '../../repositories/clampRenderFrameCount';

import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { collectWiredSidechainDetectorRoutes } from './collectWiredSidechainDetectorRoutes';
import { resolveOfflineMixAudibility } from './resolveOfflineMixAudibility';
import { resolveOutputTarget } from './resolveOutputTarget';
import { resolvePrintReachability } from './resolvePrintReachability';
import { type OfflineRenderOptions } from './types';
import { webCompensationHeadFrames } from './webCompensationHeadFrames';

type OfflineMixPlanOptions = {
    /**
     * Render the latency compensation the master arrives late by ahead of the
     * requested window, so the caller trims it from the head instead of losing
     * the window's end. A musician's export prints this way; an agent
     * measurement keeps its base span.
     */
    printsCompensationHead?: boolean;
};

function resolveBaseSpan(
    captured: ReturnType<typeof captureOfflineRenderInput>,
    onWarning?: OfflineRenderOptions['onWarning']
) {
    const { sampleRate } = captured;
    const { durationSeconds } = captured.renderContext;
    // Clamp frame count to browser-safe maximum to avoid context creation error.
    const frameCount = clampRenderFrameCount({ durationSeconds, sampleRate, onWarning });
    return { frameCount, durationSeconds, compensationHeadFrameCount: 0 };
}

/**
 * The frames a render holds, the seconds its schedulers fill, and the frames
 * the Web Audio render holds ahead of the requested window for the
 * compensation it prints. A printed head is counted exactly, history and head
 * and window, so the crop that drops the head can never overrun the render.
 *
 * The renderer's cap limits the head alone: one that does not fit is cut to
 * the room history and window leave, and the cut is reported, because the
 * export then lands that much late and loses as much from its end. A window
 * that does not fit even without a head keeps the base span and its clamp.
 */
function resolveRenderSpan(
    captured: ReturnType<typeof captureOfflineRenderInput>,
    printsCompensationHead: boolean,
    onWarning?: OfflineRenderOptions['onWarning']
) {
    if (!printsCompensationHead) {
        return resolveBaseSpan(captured, onWarning);
    }
    const { sampleRate, historyFrameCount, outputFrameCount } = captured;
    const wantedHeadFrames = webCompensationHeadFrames(captured.scheduling.latency, sampleRate);
    const roomFrames = MAX_OFFLINE_FRAMES - historyFrameCount - outputFrameCount;
    if (wantedHeadFrames === 0 || roomFrames < 0) {
        return resolveBaseSpan(captured, onWarning);
    }
    const compensationHeadFrameCount = Math.min(wantedHeadFrames, roomFrames);
    if (compensationHeadFrameCount < wantedHeadFrames) {
        const cutSeconds = ((wantedHeadFrames - compensationHeadFrameCount) / sampleRate).toFixed(3);
        onWarning?.(
            `This export is at the renderer's ${MAX_OFFLINE_FRAMES}-frame cap, so ${cutSeconds} s of the ` +
                'latency compensation its master arrives late by is not printed ahead of it: the export lands ' +
                `that much late and its last ${cutSeconds} s is not printed.`
        );
    }
    const frameCount = historyFrameCount + compensationHeadFrameCount + outputFrameCount;
    return { frameCount, durationSeconds: frameCount / sampleRate, compensationHeadFrameCount };
}

/** Decide the full-mix topology once, before choosing either renderer. */
export function resolveOfflineMixPlan(
    input: ReturnType<typeof captureOfflineRenderInput>,
    onWarning?: OfflineRenderOptions['onWarning'],
    { printsCompensationHead = false }: OfflineMixPlanOptions = {}
) {
    const { durationSeconds, ...span } = resolveRenderSpan(input, printsCompensationHead, onWarning);
    const renderContext = { ...input.renderContext, durationSeconds };
    const {
        transport,
        projectMidiEvents,
        selectMidiEventProbability,
        projectPpqEndpoints,
        resolveTempoAtBeat,
        projectChordPitch,
    } = renderContext;
    if (
        !projectMidiEvents ||
        !selectMidiEventProbability ||
        !projectPpqEndpoints ||
        !projectChordPitch ||
        !resolveTempoAtBeat
    ) {
        throw new Error('Offline musical projection is not configured');
    }

    // Use the project's master gain level (stored as 0-100) rather than a hardcoded value.
    // The ceiling is the fader's own headroom (`FADER_MAX_GAIN`), not unity —
    // matching what `createWebAudioEngine.setMasterGain` clamps live playback to.
    const masterGainValue = Math.max(0, Math.min(FADER_MAX_GAIN, (transport?.masterGain ?? 80) / 100));

    const { allRenderableTracks, sourceTracks, scheduledTracks, soloGatedByTrackId, busTrackIds, trackTrackIds } =
        resolveOfflineMixAudibility(input);
    const sidechainRoutes = input.scheduling.latency.routes;
    // Snapshot once: every strip and every gain lane in this render must see
    // the same group levels, however long the render takes.
    const vcaGroups = input.vcaGroups;
    const wiredDetectorRoutes = collectWiredSidechainDetectorRoutes({
        tracks: allRenderableTracks,
        routes: sidechainRoutes,
    });
    // Which strips this render's print can actually carry (#4376), resolved
    // before the strips are built because each strip has to be told: an
    // unrenderable device on a strip whose output cannot reach the print
    // degrades, while one that can fails the whole export. The mixdown
    // honours every strip's mute, so a route cut downstream — a track
    // routed into a muted bus — leaves an upstream contributor silent even
    // though that contributor is unmuted and scheduled.
    const contributingTrackIds = resolvePrintReachability({
        tracks: allRenderableTracks,
        honorMuted: () => true,
        sendsRendered: () => true,
        detectorRoutes: wiredDetectorRoutes,
        isSoloGated: (trackId) => soloGatedByTrackId.get(trackId) ?? false,
        resolveOutputRoute: (track) => {
            const outputTarget = resolveOutputTarget({
                outputId: track.outputId,
                busStripIds: busTrackIds,
                trackStripIds: trackTrackIds,
            });
            if (outputTarget.kind === 'bus') {
                return { kind: 'strip', trackId: outputTarget.busId };
            }
            if (outputTarget.kind === 'track') {
                return { kind: 'strip', trackId: outputTarget.trackId };
            }
            return { kind: 'prints' };
        },
    });

    // A VCA-member track plays through its group master, so the bounce has
    // to fold the same multiplier into its fader. This is the same
    // derivation the live path resolves through `getEffectiveGain`, and it
    // is 1 for a track in no group. Resolved once, before either renderer,
    // so the strips and every gain lane of one render see one snapshot.
    const vcaMultiplierByTrackId = new Map(
        allRenderableTracks.map((track): [string, number] => [
            track.id,
            deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups: vcaGroups }),
        ])
    );

    return {
        ...span,
        printsCompensationHead,
        masterGainValue,
        allRenderableTracks,
        sourceTracks,
        scheduledTracks,
        contributingTrackIds,
        soloGatedByTrackId,
        vcaMultiplierByTrackId,
        renderContext: {
            ...renderContext,
            projectMidiEvents,
            selectMidiEventProbability,
            projectPpqEndpoints,
            resolveTempoAtBeat,
            projectChordPitch,
        },
    };
}
