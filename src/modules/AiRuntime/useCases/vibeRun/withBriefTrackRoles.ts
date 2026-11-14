import { type ProjectContext, type ProjectContextProductionBrief } from '../../models/ProjectContext';
import { CANONICAL_ROLE_OPTIONS } from '../canonicalRoleFamilies';

/**
 * The roles the confirmed brief states, read onto every track that had none, exactly as the project
 * context reads an authored role: one supported role, or `unknown` beside a conflicting or unsupported
 * one. A role the project already gives is never replaced, as the brief itself never replaces one.
 */
export function withBriefTrackRoles(
    tracks: ProjectContext['tracks'],
    brief: ProjectContextProductionBrief
): ProjectContext['tracks'] {
    return tracks.map((track) => {
        if (track.canonicalRole?.source === 'authored') {
            return track;
        }
        const roles = brief.trackRoles.filter((entry) => entry.trackId === track.id).map((entry) => entry.role);
        if (roles.length === 0) {
            return track;
        }
        const supported = roles.every((role) => CANONICAL_ROLE_OPTIONS.some((option) => option === role));
        if (!supported) {
            return {
                ...track,
                canonicalRole: { role: 'unknown', source: 'authored', evidence: 'unsupported-authored-role' },
            };
        }
        if (new Set(roles).size !== 1) {
            return {
                ...track,
                canonicalRole: { role: 'unknown', source: 'authored', evidence: 'conflicting-authored-roles' },
            };
        }
        return {
            ...track,
            canonicalRole: { role: roles[0] ?? 'unknown', source: 'authored', evidence: 'authored-role' },
        };
    });
}
