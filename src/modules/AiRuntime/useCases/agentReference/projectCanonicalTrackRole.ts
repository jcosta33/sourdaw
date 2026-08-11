import { type DrumRoutingRole } from '../../models/DrumRoutingCapability';
import { type ProjectContextTrack } from '../../models/ProjectContext';

type ProjectedTrackRole =
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

function normalizeTrackName(value: string): string {
    return value
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

export function projectCanonicalTrackRole(track: ProjectContextTrack): ProjectedTrackRole {
    if (track.kind !== 'audio' && track.kind !== 'midi') {
        return { classification: 'non-drum', role: 'structural', evidence: `track-kind:${track.kind}` };
    }
    const normalizedName = normalizeTrackName(track.name);
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
