import { type ProjectContext } from '../../models/ProjectContext';

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
      };

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

const drumRolePattern =
    /\b(?:kick|snare|hi hat|hihat|hat|hats|tom|toms|cymbal|cymbals|ride|crash|clap|claps|percussion|perc|shaker|tambourine|drum|drums|overhead|overheads)\b/u;
const conflictingRolePattern = /\b(?:bass|vocal|vocals|guitar|keys|piano|strings|brass|lead)\b/u;

export function getDrumRoutingPromptScope(prompt: string, context: ProjectContext): DrumRoutingPromptScope {
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

    const targetIds: string[] = [];
    let drumTrackCount = 0;
    for (const track of context.tracks) {
        if (track.id === bus.id || track.id === parallelReturn.id) {
            continue;
        }
        const name = normalizeText(track.name);
        if (!drumRolePattern.test(name)) {
            continue;
        }
        if (conflictingRolePattern.test(name)) {
            return { status: 'invalid', reason: `MF-01 drum role is ambiguous for track ${track.id}` };
        }
        if (track.kind !== 'audio' && track.kind !== 'midi') {
            return { status: 'invalid', reason: `MF-01 cannot route structural drum target ${track.id}` };
        }
        if (track.frozen === true || track.clips.some((clip) => clip.locked === true)) {
            return { status: 'invalid', reason: `MF-01 drum target is protected or locked: ${track.id}` };
        }
        if (typeof track.outputId !== 'string') {
            return { status: 'invalid', reason: `MF-01 drum target has no authoritative output: ${track.id}` };
        }
        drumTrackCount += 1;
        if (track.outputId !== bus.id) {
            targetIds.push(track.id);
        }
    }
    if (drumTrackCount === 0) {
        return { status: 'invalid', reason: 'MF-01 found no unambiguous drum tracks' };
    }

    return {
        status: 'request',
        busId: bus.id,
        busName: bus.name,
        protectedReturnId: parallelReturn.id,
        protectedReturnName: parallelReturn.name,
        targetIds,
    };
}
