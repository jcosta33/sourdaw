import { isRecord } from '#/utils/structuralEquality';

import { type ProjectContext } from '../../../models/ProjectContext';

import { resolveProjectRange, type RangeResolution } from './resolveProjectRange';

function readNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

/** How the project resolves a call's own range argument, or null when it is no range object. */
export function resolveCallRange(range: unknown, context: ProjectContext): RangeResolution | null {
    if (!isRecord(range)) {
        return null;
    }
    return resolveProjectRange(
        {
            section: typeof range.section === 'string' ? range.section : undefined,
            startBar: readNumber(range.startBar),
            endBar: readNumber(range.endBar),
            startBeat: readNumber(range.startBeat),
            endBeat: readNumber(range.endBeat),
        },
        context
    );
}
