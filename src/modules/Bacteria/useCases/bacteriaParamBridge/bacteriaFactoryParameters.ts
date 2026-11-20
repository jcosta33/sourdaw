import { type BacteriaPatch, DEFAULT_PATCH } from '../../models/BacteriaPatch';

import { flattenPatchParams } from './flattenPatchParams';

type FactoryParameterValues = Readonly<Record<string, number | null>>;

const defaults: Readonly<Record<string, number>> = {
    ...flattenPatchParams({ ...DEFAULT_PATCH, bandCount: DEFAULT_PATCH.bands.length }, { includeBodies: true }),
    bandCount: DEFAULT_PATCH.bandCount,
};

function bandParameter(parameterId: string): { index: number; bare: string } | null {
    const band = /^band([0-5])_(.+)$/.exec(parameterId);
    if (!band?.[1] || !band[2]) {
        return null;
    }
    return { index: Number(band[1]), bare: band[2] };
}

function presetValues(patch: BacteriaPatch): Record<string, number> {
    const values = flattenPatchParams(patch, { includeBodies: true });
    for (let index = patch.bandCount; index < DEFAULT_PATCH.bands.length; index++) {
        const id = `crossoverFreq${index}`;
        if (values[id] === defaults[id]) {
            delete values[id];
        }
    }
    return values;
}

function capturedIds(values: Readonly<Record<string, number>>): string[] {
    const ids = new Set(Object.keys(values));
    for (const id of ids) {
        const band = bandParameter(id);
        if (band) {
            ids.add(band.bare);
        }
    }
    return [...ids];
}

function effectiveValue(values: FactoryParameterValues, id: string): number | undefined {
    const value = values[id];
    if (value !== null && value !== undefined) {
        return value;
    }
    const band = bandParameter(id);
    const inherited = band && values[band.bare];
    return inherited ?? defaults[id];
}

function activeBandCount(values: FactoryParameterValues): number {
    return values.bandCount ?? DEFAULT_PATCH.bandCount;
}

function captureValues(
    current: FactoryParameterValues,
    desired: Readonly<Record<string, number>>,
    session: Readonly<Record<string, number>> = {}
): { before: Record<string, number | null>; after: Record<string, number | null> } {
    const before: Record<string, number | null> = {};
    const after: Record<string, number | null> = {};
    const activeBands = activeBandCount(current);
    for (const [id, value] of Object.entries(desired)) {
        const band = bandParameter(id);
        const stored = current[id] ?? null;
        const newlyActive = band !== null && band.index >= activeBands;
        const changesProject = newlyActive || effectiveValue(current, id) !== value;
        // A queued legacy control can already be visible in the session.
        // Capture its matching project leaf so successful replay retires that frame.
        const changesSession = Object.hasOwn(session, id) && session[id] !== value;
        if (!changesProject && !changesSession) {
            continue;
        }
        before[id] = stored;
        after[id] = changesProject ? value : stored;
        if (band) {
            // The opposite replay leg may inherit this value after deleting
            // the per-band override. Guard it without rewriting it.
            const inherited = current[band.bare] ?? null;
            before[band.bare] = inherited;
            after[band.bare] = inherited;
        }
    }
    return { before, after };
}

function replayValues(before: FactoryParameterValues, after: FactoryParameterValues): Record<string, number> {
    const values: Record<string, number> = {};
    const afterCount = activeBandCount(after);
    for (const [key, stored] of Object.entries(after)) {
        const band = bandParameter(key);
        const inactive = band !== null && Object.hasOwn(after, 'bandCount') && band.index >= afterCount;
        if (stored === before[key] && (inactive || !isAuthoredParameter(key))) {
            continue;
        }
        const value = effectiveValue(after, key);
        if (value !== undefined) {
            values[key] = value;
        }
    }
    return values;
}

function isAuthoredParameter(key: string): boolean {
    return Object.hasOwn(defaults, key);
}

function isKnownParameter(key: string): boolean {
    return Object.hasOwn(defaults, key) || Object.hasOwn(defaults, `band0_${key}`);
}

export const bacteriaFactoryParameters = {
    presetValues,
    capturedIds,
    captureValues,
    replayValues,
    isKnownParameter,
    isAuthoredParameter,
};
