import { ARTICULATION_ID_BY_TYPE, type ArticulationType } from '../../models/LevainPatch';

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

const MAX_F32 = 3.402_823_466_385_288_6e38;
const MAX_U32 = 4_294_967_295;
const MAX_MICS = 8;
const MAX_RR = 12;
const MAX_ARTICULATIONS = Object.keys(ARTICULATION_ID_BY_TYPE).length;
const MAX_ZONE_ARENA = 65_536;
const MAX_ZONE_LIST_COUNT = 65_535;
const VELOCITY_BUCKET_SIZE = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
    return Number.isInteger(value) && typeof value === 'number' && value >= minimum && value <= maximum;
}

function fitsF32(value: unknown): value is number {
    return isFiniteNumber(value) && Math.abs(value) <= MAX_F32;
}

function isNonNegativeF32(value: unknown): value is number {
    return fitsF32(value) && value >= 0;
}

function isSafeRelativeSamplePath(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) {
        return false;
    }
    return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function isArticulationType(value: unknown): value is ArticulationType {
    return typeof value === 'string' && Object.hasOwn(ARTICULATION_ID_BY_TYPE, value);
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
    if (!isIntegerInRange(value.rrPos, 0, MAX_RR - 1)) {
        throw new TypeError(`${path}.rrPos must be an integer from 0 through ${MAX_RR - 1}`);
    }
    if (!isIntegerInRange(value.rrLen, 1, MAX_RR) || value.rrPos >= value.rrLen) {
        throw new TypeError(`${path}.rrLen must be an integer from 1 through ${MAX_RR} greater than rrPos`);
    }
    if (!isIntegerInRange(value.micId, 0, MAX_MICS - 1)) {
        throw new TypeError(`${path}.micId must be an integer from 0 through ${MAX_MICS - 1}`);
    }
    if (typeof value.isRelease !== 'boolean') {
        throw new TypeError(`${path}.isRelease must be a boolean`);
    }
    if (value.loopMode !== 'none' && value.loopMode !== 'forward' && value.loopMode !== 'pingpong') {
        throw new TypeError(`${path}.loopMode must be none, forward, or pingpong`);
    }
    if (!isIntegerInRange(value.loopStart, 0, MAX_U32)) {
        throw new TypeError(`${path}.loopStart must be an integer from 0 through ${MAX_U32}`);
    }
    if (!isIntegerInRange(value.loopEnd, 0, MAX_U32)) {
        throw new TypeError(`${path}.loopEnd must be an integer from 0 through ${MAX_U32}`);
    }
    const hasExplicitLoopRange = value.loopStart !== 0 || value.loopEnd !== 0;
    if (value.loopMode !== 'none' && hasExplicitLoopRange && value.loopEnd <= value.loopStart) {
        throw new TypeError(`${path}.loopEnd must be greater than loopStart for an explicit loop`);
    }
    if (!isIntegerInRange(value.loopCrossfade, 0, MAX_U32)) {
        throw new TypeError(`${path}.loopCrossfade must be an integer from 0 through ${MAX_U32}`);
    }
    if (!fitsF32(value.gainDb)) {
        throw new TypeError(`${path}.gainDb must fit a finite 32-bit float`);
    }
    if (!isNonNegativeF32(value.attack)) {
        throw new TypeError(`${path}.attack must be a non-negative finite 32-bit float`);
    }
    if (!isNonNegativeF32(value.decay)) {
        throw new TypeError(`${path}.decay must be a non-negative finite 32-bit float`);
    }
    if (!isFiniteNumber(value.sustain) || value.sustain < 0 || value.sustain > 1) {
        throw new TypeError(`${path}.sustain must be a finite number from 0 through 1`);
    }
    if (!isNonNegativeF32(value.release)) {
        throw new TypeError(`${path}.release must be a non-negative finite 32-bit float`);
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
    const canonicalId = ARTICULATION_ID_BY_TYPE[value.type];
    if (value.id !== canonicalId) {
        throw new TypeError(`${path}.id must be ${canonicalId} for ${value.type}`);
    }
    if (!Array.isArray(value.zones)) {
        throw new TypeError(`${path}.zones must be an array`);
    }
    if (value.zones.length > MAX_ZONE_LIST_COUNT) {
        throw new TypeError(`${path}.zones must contain at most ${MAX_ZONE_LIST_COUNT} entries`);
    }

    return Object.freeze({
        type: value.type,
        id: canonicalId,
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
    if (!isNonNegativeF32(value.sampleRate) || value.sampleRate === 0) {
        throw new TypeError('Levain sample manifest sampleRate must be a finite 32-bit float greater than zero');
    }
    if (
        !Array.isArray(value.micPositions) ||
        value.micPositions.length > MAX_MICS ||
        !value.micPositions.every((position) => typeof position === 'string')
    ) {
        throw new TypeError(`Levain sample manifest micPositions must contain at most ${MAX_MICS} strings`);
    }
    if (!Array.isArray(value.articulations)) {
        throw new TypeError('Levain sample manifest articulations must be an array');
    }
    if (value.articulations.length > MAX_ARTICULATIONS) {
        throw new TypeError(`Levain sample manifest articulations must contain at most ${MAX_ARTICULATIONS} entries`);
    }

    const micPositions = Object.freeze([...value.micPositions]);
    const articulations = Object.freeze(
        value.articulations.map((articulation, index) => parseArticulation(articulation, `articulations[${index}]`))
    );
    const articulationIds = new Set<number>();
    let zoneArenaEntries = 0;
    for (const articulation of articulations) {
        if (articulationIds.has(articulation.id)) {
            throw new TypeError('Levain sample manifest articulation ids must be unique');
        }
        articulationIds.add(articulation.id);
        for (const zone of articulation.zones) {
            if (zone.micId >= micPositions.length) {
                throw new TypeError(`Levain sample manifest zone micId ${zone.micId} has no mic position`);
            }
            const noteCount = zone.hiKey - zone.loKey + 1;
            const loVelocityBucket = Math.floor(zone.loVel / VELOCITY_BUCKET_SIZE);
            const hiVelocityBucket = Math.floor(zone.hiVel / VELOCITY_BUCKET_SIZE);
            zoneArenaEntries += noteCount * (hiVelocityBucket - loVelocityBucket + 1);
            if (zoneArenaEntries > MAX_ZONE_ARENA) {
                throw new TypeError(`Levain sample manifest zones exceed the ${MAX_ZONE_ARENA}-entry DSP lookup arena`);
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
