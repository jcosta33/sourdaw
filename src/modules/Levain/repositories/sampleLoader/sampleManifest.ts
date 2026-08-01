import type { ArticulationType } from '../../models/LevainPatch';

export type ManifestZone = {
    file: string;
    rootNote: number;
    loKey: number;
    hiKey: number;
    loVel: number;
    hiVel: number;
    rrPos: number;
    rrLen: number;
    micId: number;
    isRelease: boolean;
    loopMode: 'none' | 'forward' | 'pingpong';
    loopStart: number;
    loopEnd: number;
    loopCrossfade: number;
    gainDb: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
};

export type ManifestArticulation = {
    type: ArticulationType;
    id: number;
    zones: readonly ManifestZone[];
};

export type SampleManifest = {
    version: number;
    instrumentId: string;
    sampleRate: number;
    articulations: readonly ManifestArticulation[];
    micPositions: readonly string[];
};

const ARTICULATION_TYPES = [
    'sustain',
    'sustain-non-vib',
    'con-sordino',
    'flautando',
    'sul-tasto',
    'sul-ponticello',
    'harmonics',
    'spiccato',
    'staccato',
    'staccatissimo',
    'pizzicato',
    'bartok-pizz',
    'col-legno',
    'tremolo',
    'trill-half',
    'trill-whole',
    'legato',
    'legato-portamento',
    'marcato',
    'sforzando',
    'flutter-tongue',
    'muted-straight',
    'muted-cup',
    'muted-harmon',
    'muted-plunger',
    'crescendo',
    'decrescendo',
    'runs',
] as const satisfies readonly ArticulationType[];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
    return Number.isInteger(value) && typeof value === 'number' && value >= minimum && value <= maximum;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
    return isFiniteNumber(value) && value >= 0;
}

function isSafeRelativeSamplePath(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) {
        return false;
    }
    return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isArticulationType(value: unknown): value is ArticulationType {
    return typeof value === 'string' && ARTICULATION_TYPES.some((candidate) => candidate === value);
}

function parseZone(value: unknown, path: string): ManifestZone {
    if (!isRecord(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    if (!isSafeRelativeSamplePath(value.file)) {
        throw new TypeError(`${path}.file must be a safe relative sample path`);
    }
    if (!isIntegerInRange(value.rootNote, 0, 127)) {
        throw new TypeError(`${path}.rootNote must be an integer from 0 through 127`);
    }
    if (!isIntegerInRange(value.loKey, 0, 127)) {
        throw new TypeError(`${path}.loKey must be an integer from 0 through 127`);
    }
    if (!isIntegerInRange(value.hiKey, 0, 127) || value.hiKey < value.loKey) {
        throw new TypeError(`${path}.hiKey must be an integer from loKey through 127`);
    }
    if (!isIntegerInRange(value.loVel, 0, 127)) {
        throw new TypeError(`${path}.loVel must be an integer from 0 through 127`);
    }
    if (!isIntegerInRange(value.hiVel, 0, 127) || value.hiVel < value.loVel) {
        throw new TypeError(`${path}.hiVel must be an integer from loVel through 127`);
    }
    if (!isIntegerInRange(value.rrPos, 0, Number.MAX_SAFE_INTEGER)) {
        throw new TypeError(`${path}.rrPos must be a non-negative integer`);
    }
    if (!isIntegerInRange(value.rrLen, 1, Number.MAX_SAFE_INTEGER) || value.rrPos >= value.rrLen) {
        throw new TypeError(`${path}.rrLen must be a positive integer greater than rrPos`);
    }
    if (!isIntegerInRange(value.micId, 0, Number.MAX_SAFE_INTEGER)) {
        throw new TypeError(`${path}.micId must be a non-negative integer`);
    }
    if (typeof value.isRelease !== 'boolean') {
        throw new TypeError(`${path}.isRelease must be a boolean`);
    }
    if (value.loopMode !== 'none' && value.loopMode !== 'forward' && value.loopMode !== 'pingpong') {
        throw new TypeError(`${path}.loopMode must be none, forward, or pingpong`);
    }
    if (!isIntegerInRange(value.loopStart, 0, Number.MAX_SAFE_INTEGER)) {
        throw new TypeError(`${path}.loopStart must be a non-negative integer`);
    }
    if (!isIntegerInRange(value.loopEnd, 0, Number.MAX_SAFE_INTEGER)) {
        throw new TypeError(`${path}.loopEnd must be a non-negative integer`);
    }
    if (!isIntegerInRange(value.loopCrossfade, 0, Number.MAX_SAFE_INTEGER)) {
        throw new TypeError(`${path}.loopCrossfade must be a non-negative integer`);
    }
    if (!isFiniteNumber(value.gainDb)) {
        throw new TypeError(`${path}.gainDb must be a finite number`);
    }
    if (!isNonNegativeFiniteNumber(value.attack)) {
        throw new TypeError(`${path}.attack must be a non-negative finite number`);
    }
    if (!isNonNegativeFiniteNumber(value.decay)) {
        throw new TypeError(`${path}.decay must be a non-negative finite number`);
    }
    if (!isFiniteNumber(value.sustain) || value.sustain < 0 || value.sustain > 1) {
        throw new TypeError(`${path}.sustain must be a finite number from 0 through 1`);
    }
    if (!isNonNegativeFiniteNumber(value.release)) {
        throw new TypeError(`${path}.release must be a non-negative finite number`);
    }

    return Object.freeze({
        file: value.file,
        rootNote: value.rootNote,
        loKey: value.loKey,
        hiKey: value.hiKey,
        loVel: value.loVel,
        hiVel: value.hiVel,
        rrPos: value.rrPos,
        rrLen: value.rrLen,
        micId: value.micId,
        isRelease: value.isRelease,
        loopMode: value.loopMode,
        loopStart: value.loopStart,
        loopEnd: value.loopEnd,
        loopCrossfade: value.loopCrossfade,
        gainDb: value.gainDb,
        attack: value.attack,
        decay: value.decay,
        sustain: value.sustain,
        release: value.release,
    });
}

function parseArticulation(value: unknown, path: string): ManifestArticulation {
    if (!isRecord(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    if (!isArticulationType(value.type)) {
        throw new TypeError(`${path}.type is not a supported Levain articulation`);
    }
    if (!isIntegerInRange(value.id, 0, Number.MAX_SAFE_INTEGER)) {
        throw new TypeError(`${path}.id must be a non-negative integer`);
    }
    if (!Array.isArray(value.zones)) {
        throw new TypeError(`${path}.zones must be an array`);
    }

    return Object.freeze({
        type: value.type,
        id: value.id,
        zones: Object.freeze(value.zones.map((zone, index) => parseZone(zone, `${path}.zones[${index}]`))),
    });
}

export function parseSampleManifest(value: unknown): SampleManifest {
    if (!isRecord(value)) {
        throw new TypeError('Levain sample manifest must be an object');
    }
    if (!isIntegerInRange(value.version, 1, Number.MAX_SAFE_INTEGER)) {
        throw new TypeError('Levain sample manifest version must be a positive integer');
    }
    if (typeof value.instrumentId !== 'string' || value.instrumentId.length === 0) {
        throw new TypeError('Levain sample manifest instrumentId must be a non-empty string');
    }
    if (!isNonNegativeFiniteNumber(value.sampleRate) || value.sampleRate === 0) {
        throw new TypeError('Levain sample manifest sampleRate must be greater than zero');
    }
    if (!Array.isArray(value.micPositions) || !value.micPositions.every((position) => typeof position === 'string')) {
        throw new TypeError('Levain sample manifest micPositions must contain only strings');
    }
    if (!Array.isArray(value.articulations)) {
        throw new TypeError('Levain sample manifest articulations must be an array');
    }

    const micPositions = Object.freeze([...value.micPositions]);
    const articulations = Object.freeze(
        value.articulations.map((articulation, index) => parseArticulation(articulation, `articulations[${index}]`))
    );
    const articulationIds = new Set<number>();
    for (const articulation of articulations) {
        if (articulationIds.has(articulation.id)) {
            throw new TypeError('Levain sample manifest articulation ids must be unique');
        }
        articulationIds.add(articulation.id);
        for (const zone of articulation.zones) {
            if (zone.micId >= micPositions.length) {
                throw new TypeError(`Levain sample manifest zone micId ${zone.micId} has no mic position`);
            }
        }
    }

    return Object.freeze({
        version: value.version,
        instrumentId: value.instrumentId,
        sampleRate: value.sampleRate,
        micPositions,
        articulations,
    });
}
