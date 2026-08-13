import {
    ARTICULATION_ID_BY_TYPE,
    isArticulationType,
    isInstrumentId,
    type ArticulationType,
    type InstrumentId,
} from '../../models/LevainPatch';

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
    loop: ManifestLoop;
    gainDb: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
};

export type ManifestLoop =
    | { mode: 'none' }
    | {
          mode: 'forward' | 'pingpong';
          startFrame: number;
          endFrame: number | 'sample-end';
          crossfadeFrames: number;
      };
export type ManifestArticulation = {
    type: ArticulationType;
    id: number;
    zones: readonly ManifestZone[];
};

/** Transition kinds the DSP's `TransitionType` can be addressed by, in its own order. */
export const LEGATO_TRANSITION_TYPES = ['slurred', 'portamento', 'run', 'rip', 'fall'] as const;
export type LegatoTransitionType = (typeof LEGATO_TRANSITION_TYPES)[number];

/** Dynamic layers a transition can be recorded at, in `Dynamic`'s own order. */
export const LEGATO_DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'] as const;
export type LegatoDynamic = (typeof LEGATO_DYNAMICS)[number];

/**
 * One recorded interval sample: the note-to-note transition a library records
 * so a slur sounds like the player moving rather than like two notes
 * crossfaded. SFZ models the same thing as a region with `trigger=legato`,
 * which "will play on note-on, but only if there's a note going on".
 *
 * Optional, and no bank in this repo ships one. Registering a transition is
 * what makes the engine prefer a recording over its crossfade fallback for
 * that interval, so this is the channel real interval recordings arrive
 * through when they exist.
 */
export type ManifestLegatoTransition = {
    file: string;
    /** Semitones, `newNote - oldNote`. Non-zero, within the DSP's ±12 lookup range. */
    interval: number;
    transitionType: LegatoTransitionType;
    dynamic: LegatoDynamic;
    crossfadeInMs: number;
    crossfadeOutMs: number;
};

export type SampleManifest = {
    version: 1;
    instrumentId: InstrumentId;
    sampleRate: number;
    articulations: readonly ManifestArticulation[];
    micPositions: readonly string[];
    legatoTransitions: readonly ManifestLegatoTransition[];
};

const MAX_F32 = 3.402_823_466_385_288_6e38;
const MAX_U32 = 4_294_967_295;
const MAX_MICS = 8;
const MAX_RR = 12;
const MAX_ARTICULATIONS = Object.keys(ARTICULATION_ID_BY_TYPE).length;
const MAX_ZONE_ARENA = 65_536;
/** `LegatoTransitionStore::MAX_TRANSITIONS` — anything past this is dropped by the DSP. */
const MAX_LEGATO_TRANSITIONS = 1024;
/** `MAX_LEGATO_INTERVAL` — the widest interval the DSP's transition lookup covers. */
const MAX_LEGATO_INTERVAL = 12;
const MAX_ZONE_LIST_COUNT = 65_535;
const VELOCITY_BUCKET_SIZE = 8;
const SAMPLE_BANK_BASE_URL = new URL('https://sourdaw.invalid/bank/');

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

function toPositiveF32(value: unknown): number | undefined {
    if (!isFiniteNumber(value)) {
        return undefined;
    }

    const rounded = Math.fround(value);
    if (!Number.isFinite(rounded) || rounded <= 0) {
        return undefined;
    }
    return rounded;
}

function isSafeRelativeSamplePath(value: unknown): value is string {
    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.startsWith('/') ||
        value.includes('\\') ||
        /^[A-Za-z][A-Za-z\d+.-]*:/.test(value) ||
        /%(?:2f|5c)/i.test(value)
    ) {
        return false;
    }
    if (!value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')) {
        return false;
    }

    const resolved = new URL(value, SAMPLE_BANK_BASE_URL);
    return (
        resolved.origin === SAMPLE_BANK_BASE_URL.origin && resolved.pathname.startsWith(SAMPLE_BANK_BASE_URL.pathname)
    );
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

    let loop: ManifestLoop = Object.freeze({ mode: 'none' });
    if (value.loopMode !== 'none') {
        loop = Object.freeze({
            mode: value.loopMode,
            startFrame: value.loopStart,
            endFrame: hasExplicitLoopRange ? value.loopEnd : 'sample-end',
            crossfadeFrames: value.loopCrossfade,
        });
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
        loop,
        gainDb: value.gainDb,
        attack: value.attack,
        decay: value.decay,
        sustain: value.sustain,
        release: value.release,
    });
}

function isLegatoTransitionType(value: unknown): value is LegatoTransitionType {
    return LEGATO_TRANSITION_TYPES.some((candidate) => candidate === value);
}

function isLegatoDynamic(value: unknown): value is LegatoDynamic {
    return LEGATO_DYNAMICS.some((candidate) => candidate === value);
}

function parseLegatoTransition(value: unknown, path: string): ManifestLegatoTransition {
    if (!isRecord(value)) {
        throw new TypeError(`${path} must be an object`);
    }
    if (!isSafeRelativeSamplePath(value.file)) {
        throw new TypeError(`${path}.file must be a safe relative sample path`);
    }
    if (!isIntegerInRange(value.interval, -MAX_LEGATO_INTERVAL, MAX_LEGATO_INTERVAL) || value.interval === 0) {
        throw new TypeError(
            `${path}.interval must be a non-zero integer from -${MAX_LEGATO_INTERVAL} through ${MAX_LEGATO_INTERVAL}`
        );
    }
    if (!isLegatoTransitionType(value.transitionType)) {
        throw new TypeError(`${path}.transitionType must be one of ${LEGATO_TRANSITION_TYPES.join(', ')}`);
    }
    if (!isLegatoDynamic(value.dynamic)) {
        throw new TypeError(`${path}.dynamic must be one of ${LEGATO_DYNAMICS.join(', ')}`);
    }
    if (!isNonNegativeF32(value.crossfadeInMs)) {
        throw new TypeError(`${path}.crossfadeInMs must be a non-negative finite 32-bit float`);
    }
    if (!isNonNegativeF32(value.crossfadeOutMs)) {
        throw new TypeError(`${path}.crossfadeOutMs must be a non-negative finite 32-bit float`);
    }

    return Object.freeze({
        file: value.file,
        interval: value.interval,
        transitionType: value.transitionType,
        dynamic: value.dynamic,
        crossfadeInMs: value.crossfadeInMs,
        crossfadeOutMs: value.crossfadeOutMs,
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

    const zones = Object.freeze(value.zones.map((zone, index) => parseZone(zone, `${path}.zones[${index}]`)));
    if (!zones.some((zone) => !zone.isRelease)) {
        throw new TypeError(`${path} must contain a playable note-on zone`);
    }

    return Object.freeze({
        type: value.type,
        id: canonicalId,
        zones,
    });
}

export function parseSampleManifest(value: unknown): SampleManifest {
    if (!isRecord(value)) {
        throw new TypeError('Levain sample manifest must be an object');
    }
    if (value.version !== 1) {
        throw new TypeError('Levain sample manifest version must be 1');
    }
    if (!isInstrumentId(value.instrumentId)) {
        throw new TypeError('Levain sample manifest instrumentId must be a supported instrument id');
    }
    const sampleRate = toPositiveF32(value.sampleRate);
    if (sampleRate === undefined) {
        throw new TypeError('Levain sample manifest sampleRate must be a finite 32-bit float greater than zero');
    }
    if (
        !Array.isArray(value.micPositions) ||
        value.micPositions.length === 0 ||
        value.micPositions.length > MAX_MICS ||
        !value.micPositions.every((position) => typeof position === 'string')
    ) {
        throw new TypeError(`Levain sample manifest micPositions must contain 1 through ${MAX_MICS} microphone names`);
    }
    if (!Array.isArray(value.articulations) || value.articulations.length === 0) {
        throw new TypeError('Levain sample manifest articulations must contain at least one articulation');
    }
    if (value.articulations.length > MAX_ARTICULATIONS) {
        throw new TypeError(`Levain sample manifest articulations must contain at most ${MAX_ARTICULATIONS} entries`);
    }

    let rawZoneCount = 0;
    for (const articulation of value.articulations) {
        if (isRecord(articulation) && Array.isArray(articulation.zones)) {
            rawZoneCount += articulation.zones.length;
        }
    }
    if (rawZoneCount > MAX_ZONE_ARENA) {
        throw new TypeError(`Levain sample manifest contains more than ${MAX_ZONE_ARENA} zones`);
    }

    if (value.legatoTransitions !== undefined && !Array.isArray(value.legatoTransitions)) {
        throw new TypeError('Levain sample manifest legatoTransitions must be an array when present');
    }
    const rawLegatoTransitions: readonly unknown[] = Array.isArray(value.legatoTransitions)
        ? value.legatoTransitions
        : [];
    if (rawLegatoTransitions.length > MAX_LEGATO_TRANSITIONS) {
        throw new TypeError(
            `Levain sample manifest legatoTransitions must contain at most ${MAX_LEGATO_TRANSITIONS} entries`
        );
    }
    const legatoTransitions = Object.freeze(
        rawLegatoTransitions.map((transition, index) =>
            parseLegatoTransition(transition, `legatoTransitions[${index}]`)
        )
    );

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
        sampleRate,
        micPositions,
        articulations,
        legatoTransitions,
    });
}
