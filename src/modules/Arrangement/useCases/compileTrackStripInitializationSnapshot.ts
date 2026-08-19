import { getRuntimeGraphRevision, resolveToasterPadBinding } from '#/modules/AudioEngine/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { getTrackEligibility } from '../stores/trackEligibility';
import { type Track } from '../stores/trackStore';

import { runtimeGraphTopology } from './runtimeGraphTopology';

/**
 * Compiles the one immutable, validated live-strip baseline shared by project
 * rehydration and post-commit recovery. Callers must not replay device writes
 * to create a missing strip.
 */
export function compileTrackStripInitializationSnapshot(track: Track, tracks: readonly Track[]) {
    const source = runtimeGraphTopology.createNode(track);
    const targets =
        track.outputId === 'master' || track.outputId === 'hw_out'
            ? []
            : tracks.filter((candidate) => candidate.id === track.outputId);
    if (targets.length > 1 || (targets[0] && !getTrackEligibility(targets[0].kind).acceptsRoutingEndpoint)) {
        return null;
    }
    const target = targets[0];
    const padBinding = resolveToasterPadBinding(tracks, track.id);
    return {
        schemaVersion: 1,
        command: 'initialize-track-strip',
        correlation: {
            appRevision: getRuntimeGraphRevision(),
            projectRevision: captureProjectRevision(),
        },
        nodes: target ? [source, runtimeGraphTopology.createNode(target)] : [source],
        output: {
            kind: 'output',
            sourceId: track.id,
            targetId: track.outputId,
            ...(padBinding ? { padBinding } : {}),
        },
        parameters: [],
    };
}
