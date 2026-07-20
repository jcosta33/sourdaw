import { GROOVE_SUBDIVISIONS } from '../../models/GrooveTemplate';

export function getSupportedGrooveSubdivisions(): string[] {
    return [...GROOVE_SUBDIVISIONS];
}
