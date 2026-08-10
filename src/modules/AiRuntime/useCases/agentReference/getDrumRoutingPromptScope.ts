import {
    type DrumRoutingCandidate,
    type DrumRoutingCapability,
    type DrumRoutingProtectedTrack,
    type DrumRoutingRole,
} from '../../models/DrumRoutingCapability';
import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';

type DrumRoutingPromptScope =
    | { status: 'none' }
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

type ProjectedRole =
    | { classification: 'drum'; role: DrumRoutingRole; evidence: string }
    | { classification: 'non-drum'; role: string; evidence: string }
    | { classification: 'ambiguous' };

const drumRoleAliases: ReadonlyArray<{ role: DrumRoutingRole; pattern: RegExp }> = [
    {
        role: 'kick',
        pattern: /^(?:kick|kick drum|bass drum|bd)(?: (?:in|out|inside|outside|sub|close|far|mic|[0-9]+))*$/u,
    },
    { role: 'snare', pattern: /^(?:snare|snare drum|sd)(?: (?:top|bottom|side|close|far|mic|[0-9]+))*$/u },
    { role: 'hi-hat', pattern: /^(?:hi hat|hihat|hat|hats|hh)(?: (?:open|closed|pedal|mic|[0-9]+))*$/u },
    { role: 'tom', pattern: /^(?:tom|toms|rack tom|floor tom|high tom|mid tom|low tom)(?: [0-9]+)*$/u },
    { role: 'cymbal', pattern: /^(?:cymbal|cymbals|ride|crash|china|splash)(?: (?:left|right|l|r|mic|[0-9]+))*$/u },
    {
        role: 'percussion',
        pattern: /^(?:percussion|perc|shaker|tambourine|clap|claps|cowbell|conga|bongo)(?: [0-9]+)*$/u,
    },
    {
        role: 'overhead',
        pattern: /^(?:oh|overhead|overheads|drum overhead|drum overheads)(?: (?:left|right|l|r|mono|stereo|[0-9]+))*$/u,
    },
    { role: 'room', pattern: /^(?:drum room|drums room|room drum|room drums)(?: (?:close|far|mono|stereo|[0-9]+))*$/u },
];

const nonDrumRoleAliases: ReadonlyArray<{ role: string; pattern: RegExp }> = [
    { role: 'bass-instrument', pattern: /^(?:bass|bass di|bass guitar|bass synth)(?: [0-9]+)*$/u },
    { role: 'vocal', pattern: /^(?:(?:lead|backing|background) )?vocals?(?: [0-9]+)*$/u },
    { role: 'guitar', pattern: /^(?:(?:lead|rhythm|electric|acoustic) )?guitar(?: [0-9]+)*$/u },
    { role: 'keys', pattern: /^(?:(?:lead|bass) )?(?:keys|piano|organ|synth|pad|strings|brass)(?: [0-9]+)*$/u },
    { role: 'utility', pattern: /^(?:fx|effects|reference|click|metronome|hat trick)(?: [0-9]+)*$/u },
];

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function projectTrackRole(track: ProjectContextTrack): ProjectedRole {
    if (track.kind !== 'audio' && track.kind !== 'midi') {
        return { classification: 'non-drum', role: 'structural', evidence: `track-kind:${track.kind}` };
    }
    const normalizedName = normalizeText(track.name);
    for (const alias of drumRoleAliases) {
        if (alias.pattern.test(normalizedName)) {
            return {
                classification: 'drum',
                role: alias.role,
                evidence: `canonical-name:${normalizedName}`,
            };
        }
    }
    for (const alias of nonDrumRoleAliases) {
        if (alias.pattern.test(normalizedName)) {
            return {
                classification: 'non-drum',
                role: alias.role,
                evidence: `canonical-name:${normalizedName}`,
            };
        }
    }
    return { classification: 'ambiguous' };
}

function isLocked(track: ProjectContextTrack): boolean {
    return track.clips.some((clip) => clip.locked === true);
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

export function getDrumRoutingPromptScope(
    prompt: string,
    context: ProjectContext,
    projectRevision?: string
): DrumRoutingPromptScope {
    const normalizedPrompt = normalizeText(prompt);
    const isRequest =
        normalizedPrompt === 'route every drum track except the parallel compression return into the drum bus';
    if (!isRequest) {
        return { status: 'none' };
    }

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

    const candidateDrums: DrumRoutingCandidate[] = [];
    const protectedNonDrums: DrumRoutingProtectedTrack[] = [];
    for (const track of context.tracks) {
        if (track.id === bus.id || track.id === parallelReturn.id) {
            continue;
        }
        const projection = projectTrackRole(track);
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
