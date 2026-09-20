import { deriveVcaMultiplier } from '#/modules/Arrangement/stores';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { clampRenderFrameCount } from '../../repositories/clampRenderFrameCount';

import { type captureOfflineRenderInput } from './captureOfflineRenderInput';
import { collectWiredSidechainDetectorRoutes } from './collectWiredSidechainDetectorRoutes';
import { resolveOfflineMixAudibility } from './resolveOfflineMixAudibility';
import { resolveOutputTarget } from './resolveOutputTarget';
import { resolvePrintReachability } from './resolvePrintReachability';
import { type OfflineRenderOptions } from './types';

/** Decide the full-mix topology once, before choosing either renderer. */
export function resolveOfflineMixPlan(
    input: ReturnType<typeof captureOfflineRenderInput>,
    onWarning?: OfflineRenderOptions['onWarning']
) {
    const { sampleRate, renderContext } = input;
    const {
        transport,
        durationSeconds,
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

    // Clamp frame count to browser-safe maximum to avoid context creation error.
    const frameCount = clampRenderFrameCount({ durationSeconds, sampleRate, onWarning });
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
    const routableSidechainTargets = new Set<object>(wiredDetectorRoutes.map((route) => route.targetDevice));
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
        frameCount,
        masterGainValue,
        allRenderableTracks,
        sourceTracks,
        scheduledTracks,
        routableSidechainTargets,
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
