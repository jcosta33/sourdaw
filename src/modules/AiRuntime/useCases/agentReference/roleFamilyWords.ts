/** The words a request names one role family by, singular and plural ("drum", "drums"; "bass", "basses"). */
export function readRoleFamilyWords(role: string): string[] {
    if (role === 'bass') {
        return ['bass', 'basses'];
    }
    if (role === 'bus') {
        return ['bus', 'buses'];
    }
    const singular = role.endsWith('s') ? role.slice(0, -1) : role;
    return [singular, `${singular}s`];
}
