import {
    type DrumRoutingCandidate,
    type DrumRoutingCapability,
    type DrumRoutingProtectedTrack,
    type DrumRoutingRole,
} from '../../models/DrumRoutingCapability';
import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';

import { projectCanonicalTrackRole } from './projectCanonicalTrackRole';
import { resolveWorkflowTrackIds } from './resolveWorkflowTrackIds';

type DrumRoutingPromptScope =
    | { status: 'invalid'; reason: string }
    | {
          status: 'request';
          busId: string;
          busName: string;
          protectedReturnId: string;
          protectedReturnName: string;
          targetIds: string[];
          capability?: DrumRoutingCapability;
      };

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function isLocked(track: ProjectContextTrack): boolean {
    return track.clips.some((clip) => clip.locked === true);
}

type RoutingClassification = ReturnType<typeof projectCanonicalTrackRole>;

const DRUM_ROLE_BY_CANONICAL_ROLE: Partial<Record<string, DrumRoutingRole>> = {
    kick: 'kick',
    snare: 'snare',
    'hi-hat': 'hi-hat',
    tom: 'tom',
    cymbal: 'cymbal',
    percussion: 'percussion',
};

function describeCanonicalRole(canonicalRole: ProjectContextTrack['canonicalRole']): {
    role: string;
    evidence: string;
} {
    const role = canonicalRole?.role ?? 'drums';
    return { role, evidence: `canonical-role:${role}:${canonicalRole?.source ?? 'unknown'}` };
}

// Frozen and locked drums stay in this set on purpose: they refuse the whole scope instead of
// silently dropping out of it.
function resolveDrumTrackIds(context: ProjectContext): ReadonlySet<string> {
    return new Set(resolveWorkflowTrackIds(context, 'drum-routing-drums', { all: [{ roleFamily: 'drums' }] }));
}

/**
 * Whether a track is a drum, protected, or unclassifiable. Drum membership is the shared
 * resolver's `roleFamily: 'drums'`, which reads the track's canonical role, so a role the user
 * set in the inspector decides it either way. The name aliases only supply the role label the
 * provider sees for a name-derived role, and classify a track whose canonical role is `unknown`
 * because its name ("Hats", "OH", "BD") carries evidence the canonical name patterns do not
 * recognise.
 */
function classifyRoutingTrack(track: ProjectContextTrack, drumTrackIds: ReadonlySet<string>): RoutingClassification {
    const named = projectCanonicalTrackRole(track);
    const canonicalRole = track.canonicalRole;
    if (drumTrackIds.has(track.id)) {
        if (named.classification === 'drum' && canonicalRole?.source !== 'authored') {
            return named;
        }
        const described = describeCanonicalRole(canonicalRole);
        return {
            classification: 'drum',
            role: DRUM_ROLE_BY_CANONICAL_ROLE[described.role] ?? 'drums',
            evidence: described.evidence,
        };
    }
    if (canonicalRole === undefined || canonicalRole.role === 'unknown') {
        return named;
    }
    if (named.classification === 'non-drum') {
        return named;
    }
    return { classification: 'non-drum', ...describeCanonicalRole(canonicalRole) };
}

function toProtectedTrack(track: ProjectContextTrack, role: string, evidence: string): DrumRoutingProtectedTrack {
    return {
        id: track.id,
        name: track.name,
        kind: track.kind,
        role,
        roleEvidence: evidence,
        currentOutputId: typeof track.outputId === 'string' ? track.outputId : null,
        frozen: track.frozen === true,
        locked: isLocked(track),
    };
}

export function getDrumRoutingPromptScope(context: ProjectContext, projectRevision?: string): DrumRoutingPromptScope {
    const buses = context.tracks.filter((track) => track.kind === 'bus' && normalizeText(track.name) === 'drum bus');
    if (buses.length !== 1) {
        return { status: 'invalid', reason: 'MF-01 requires exactly one existing Drum Bus' };
    }
    const bus = buses[0];
    if (!bus) {
        return { status: 'invalid', reason: 'MF-01 requires exactly one existing Drum Bus' };
    }

    const parallelReturns = context.tracks.filter((track) => {
        const name = normalizeText(track.name);
        return name === 'parallel compression' || name === 'parallel compression return';
    });
    if (parallelReturns.length !== 1) {
        return {
            status: 'invalid',
            reason: 'MF-01 requires exactly one unambiguous Parallel Compression return',
        };
    }
    const parallelReturn = parallelReturns[0];
    if (!parallelReturn) {
        return {
            status: 'invalid',
            reason: 'MF-01 requires exactly one unambiguous Parallel Compression return',
        };
    }

    const drumTrackIds = resolveDrumTrackIds(context);
    const candidateDrums: DrumRoutingCandidate[] = [];
    const protectedNonDrums: DrumRoutingProtectedTrack[] = [];
    for (const track of context.tracks) {
        if (track.id === bus.id || track.id === parallelReturn.id) {
            continue;
        }
        const projection = classifyRoutingTrack(track, drumTrackIds);
        if (projection.classification === 'ambiguous') {
            return { status: 'invalid', reason: `MF-01 track role is ambiguous: ${track.id}` };
        }
        if (projection.classification === 'non-drum') {
            protectedNonDrums.push(toProtectedTrack(track, projection.role, projection.evidence));
            continue;
        }
        if (track.kind !== 'audio' && track.kind !== 'midi') {
            return { status: 'invalid', reason: `MF-01 cannot route structural drum target ${track.id}` };
        }
        if (track.frozen === true || isLocked(track)) {
            return { status: 'invalid', reason: `MF-01 drum target is protected or locked: ${track.id}` };
        }
        if (typeof track.outputId !== 'string') {
            return { status: 'invalid', reason: `MF-01 drum target has no authoritative output: ${track.id}` };
        }
        candidateDrums.push({
            id: track.id,
            name: track.name,
            kind: track.kind,
            role: projection.role,
            roleEvidence: projection.evidence,
            currentOutputId: track.outputId,
            frozen: false,
            locked: false,
        });
    }
    if (candidateDrums.length === 0) {
        return { status: 'invalid', reason: 'MF-01 found no unambiguous drum tracks' };
    }

    const targetIds = candidateDrums.filter((track) => track.currentOutputId !== bus.id).map((track) => track.id);
    const protectedReturn = toProtectedTrack(parallelReturn, 'parallel-compression-return', 'exact-protected-name');
    const capability: DrumRoutingCapability | undefined = projectRevision
        ? {
              schemaVersion: 1,
              baseRevision: projectRevision,
              actionType: 'setTrackOutput',
              bus: { id: bus.id, name: bus.name, kind: 'bus' },
              candidateDrums,
              protectedReturn,
              protectedNonDrums,
              allowedAction: {
                  type: 'setTrackOutput',
                  exactTargetIds: targetIds,
                  outputId: bus.id,
                  requiredPayloadKeys: ['trackId', 'outputId'],
                  forbiddenTargetIds: [parallelReturn.id, ...protectedNonDrums.map((track) => track.id)],
              },
              constraints: {
                  requireCompleteExactTargetSet: true,
                  requireFreshConfirmation: true,
                  preserveProtectedTracks: true,
              },
          }
        : undefined;

    return {
        status: 'request',
        busId: bus.id,
        busName: bus.name,
        protectedReturnId: parallelReturn.id,
        protectedReturnName: parallelReturn.name,
        targetIds,
        capability,
    };
}
