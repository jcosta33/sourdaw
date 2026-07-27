const EXPRESSION_LANE_IDS = ['pitch', 'pressure', 'timbre'] as const;
const EXPRESSION_SCOPES = ['channel', 'note'] as const;
const TUNING_MODELS = ['fixed-equal-temperament', 'channel-pitch-bend', 'per-note-pitch'] as const;
const CHANNEL_MODELS = ['single-channel', 'multi-channel', 'mpe'] as const;
const MPE_ZONES = ['none', 'lower', 'upper'] as const;
const ARTICULATION_SWITCHING_KINDS = ['none', 'key-switch', 'program-change', 'control-change'] as const;
const DRUM_MAP_KINDS = ['none', 'general-midi', 'instrument-defined'] as const;
const EXPRESSION_TIERS = ['none', 'channel', 'polyphonic', 'mpe'] as const;
const DESCRIPTOR_KEYS = [
    'schemaVersion',
    'instrumentId',
    'semanticsRevision',
    'expressionLanes',
    'tuningModel',
    'channelModel',
    'mpe',
    'articulationSwitching',
    'drumMap',
    'expressionTier',
] as const;
const REGISTERED_DESCRIPTOR_KEYS = [...DESCRIPTOR_KEYS, 'availability'] as const;
const MPE_KEYS = ['zone', 'memberChannels', 'maxVoices'] as const;
const SUPPORTED_LANE_KEYS = ['laneId', 'support', 'scope'] as const;
const UNAVAILABLE_LANE_KEYS = ['laneId', 'support', 'reasonCode'] as const;
const REASON_CODE_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export type InstrumentExpressionLaneId = (typeof EXPRESSION_LANE_IDS)[number];
export type InstrumentExpressionScope = (typeof EXPRESSION_SCOPES)[number];
export type InstrumentTuningModel = (typeof TUNING_MODELS)[number];
export type InstrumentChannelModel = (typeof CHANNEL_MODELS)[number];
export type InstrumentMpeZone = (typeof MPE_ZONES)[number];
export type InstrumentArticulationSwitching = (typeof ARTICULATION_SWITCHING_KINDS)[number];
export type InstrumentDrumMap = (typeof DRUM_MAP_KINDS)[number];
export type InstrumentExpressionTier = (typeof EXPRESSION_TIERS)[number];

type SupportedExpressionLane = Readonly<{
    laneId: InstrumentExpressionLaneId;
    support: 'supported';
    scope: InstrumentExpressionScope;
}>;

type UnavailableExpressionLane = Readonly<{
    laneId: InstrumentExpressionLaneId;
    support: 'unavailable';
    reasonCode: string;
}>;

export type InstrumentExpressionLane = SupportedExpressionLane | UnavailableExpressionLane;

export type InstrumentCapabilitiesDescriptorInput = Readonly<{
    schemaVersion: 1;
    instrumentId: string;
    semanticsRevision: number;
    expressionLanes: readonly InstrumentExpressionLane[];
    tuningModel: InstrumentTuningModel;
    channelModel: InstrumentChannelModel;
    mpe: Readonly<{
        zone: InstrumentMpeZone;
        memberChannels: number;
        maxVoices: number;
    }>;
    articulationSwitching: InstrumentArticulationSwitching;
    drumMap: InstrumentDrumMap;
    expressionTier: InstrumentExpressionTier;
}>;

export type RegisteredInstrumentCapabilities = InstrumentCapabilitiesDescriptorInput &
    Readonly<{
        availability: 'registered';
    }>;

export type GenericInstrumentCapabilities = Readonly<{
    availability: 'unavailable';
    unavailableReason: 'unknown-or-incompatible';
    schemaVersion: 1;
    instrumentId: string;
    semanticsRevision: 0;
    expressionLanes: readonly [];
    tuningModel: 'unavailable';
    channelModel: 'unavailable';
    mpe: Readonly<{
        zone: 'none';
        memberChannels: 0;
        maxVoices: 0;
    }>;
    articulationSwitching: 'none';
    drumMap: 'none';
    expressionTier: 'none';
}>;

export type InstrumentCapabilitiesProjection = RegisteredInstrumentCapabilities | GenericInstrumentCapabilities;

function readDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== expectedKeys.length) {
        return null;
    }

    const expectedKeySet = new Set(expectedKeys);
    const properties: Record<string, unknown> = {};
    for (const ownKey of ownKeys) {
        if (typeof ownKey !== 'string' || !expectedKeySet.has(ownKey)) {
            return null;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, ownKey);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        properties[ownKey] = descriptor.value;
    }
    return properties;
}

function readDenseArray(value: unknown): readonly unknown[] | null {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return null;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
        return null;
    }

    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        items.push(descriptor.value);
    }
    return items;
}

function readOwnDataProperty(value: unknown, key: string): unknown {
    if (value === null || typeof value !== 'object') {
        return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return undefined;
    }
    return descriptor.value;
}

function isLiteralMember<const Value extends string>(value: unknown, members: readonly Value[]): value is Value {
    if (typeof value !== 'string') {
        return false;
    }
    return members.some((member) => member === value);
}

function isSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value);
}

function normalizeExpressionLane(value: unknown): InstrumentExpressionLane | null {
    const support = readOwnDataProperty(value, 'support');
    if (support === 'supported') {
        const properties = readDataObject(value, SUPPORTED_LANE_KEYS);
        if (
            !properties ||
            !isLiteralMember(properties.laneId, EXPRESSION_LANE_IDS) ||
            !isLiteralMember(properties.scope, EXPRESSION_SCOPES)
        ) {
            return null;
        }
        return Object.freeze({
            laneId: properties.laneId,
            support: 'supported',
            scope: properties.scope,
        });
    }
    if (support === 'unavailable') {
        const properties = readDataObject(value, UNAVAILABLE_LANE_KEYS);
        if (
            !properties ||
            !isLiteralMember(properties.laneId, EXPRESSION_LANE_IDS) ||
            typeof properties.reasonCode !== 'string' ||
            !REASON_CODE_PATTERN.test(properties.reasonCode)
        ) {
            return null;
        }
        return Object.freeze({
            laneId: properties.laneId,
            support: 'unavailable',
            reasonCode: properties.reasonCode,
        });
    }
    return null;
}

function normalizeExpressionLanes(value: unknown): readonly InstrumentExpressionLane[] | null {
    const items = readDenseArray(value);
    if (!items || items.length !== EXPRESSION_LANE_IDS.length) {
        return null;
    }

    const laneIds = new Set<InstrumentExpressionLaneId>();
    const lanes: InstrumentExpressionLane[] = [];
    for (const item of items) {
        const lane = normalizeExpressionLane(item);
        if (!lane || laneIds.has(lane.laneId)) {
            return null;
        }
        laneIds.add(lane.laneId);
        lanes.push(lane);
    }
    return Object.freeze(lanes);
}

function normalizeMpe(value: unknown): InstrumentCapabilitiesDescriptorInput['mpe'] | null {
    const properties = readDataObject(value, MPE_KEYS);
    if (
        !properties ||
        !isLiteralMember(properties.zone, MPE_ZONES) ||
        !isSafeInteger(properties.memberChannels) ||
        !isSafeInteger(properties.maxVoices)
    ) {
        return null;
    }
    const memberChannels = properties.memberChannels;
    const maxVoices = properties.maxVoices;
    if (memberChannels < 0 || memberChannels > 15 || maxVoices < 0 || maxVoices > 15) {
        return null;
    }
    return Object.freeze({
        zone: properties.zone,
        memberChannels,
        maxVoices,
    });
}

function hasCoherentModels(input: {
    expressionLanes: readonly InstrumentExpressionLane[];
    tuningModel: InstrumentTuningModel;
    channelModel: InstrumentChannelModel;
    mpe: InstrumentCapabilitiesDescriptorInput['mpe'];
    expressionTier: InstrumentExpressionTier;
}): boolean {
    const supportedLanes = input.expressionLanes.filter((lane) => lane.support === 'supported');
    const hasNoteLane = supportedLanes.some((lane) => lane.scope === 'note');

    if (input.channelModel === 'mpe') {
        if (
            input.mpe.zone === 'none' ||
            input.mpe.memberChannels === 0 ||
            input.mpe.maxVoices === 0 ||
            input.mpe.maxVoices > input.mpe.memberChannels ||
            input.expressionTier !== 'mpe'
        ) {
            return false;
        }
    } else if (
        input.mpe.zone !== 'none' ||
        input.mpe.memberChannels !== 0 ||
        input.mpe.maxVoices !== 0 ||
        input.expressionTier === 'mpe'
    ) {
        return false;
    }

    if (input.channelModel === 'single-channel' && hasNoteLane) {
        return false;
    }
    if (input.channelModel !== 'multi-channel' && input.expressionTier === 'polyphonic') {
        return false;
    }
    if (input.tuningModel === 'per-note-pitch' && input.channelModel === 'single-channel') {
        return false;
    }
    if (input.expressionTier === 'none' && supportedLanes.length > 0) {
        return false;
    }
    if (input.expressionTier === 'channel' && hasNoteLane) {
        return false;
    }
    return true;
}

export function normalizeInstrumentCapabilitiesDescriptor(
    value: unknown
): InstrumentCapabilitiesDescriptorInput | null {
    const properties = readDataObject(value, DESCRIPTOR_KEYS);
    if (
        !properties ||
        properties.schemaVersion !== 1 ||
        typeof properties.instrumentId !== 'string' ||
        properties.instrumentId.length === 0 ||
        properties.instrumentId.trim() !== properties.instrumentId ||
        !isSafeInteger(properties.semanticsRevision) ||
        properties.semanticsRevision < 1 ||
        !isLiteralMember(properties.tuningModel, TUNING_MODELS) ||
        !isLiteralMember(properties.channelModel, CHANNEL_MODELS) ||
        !isLiteralMember(properties.articulationSwitching, ARTICULATION_SWITCHING_KINDS) ||
        !isLiteralMember(properties.drumMap, DRUM_MAP_KINDS) ||
        !isLiteralMember(properties.expressionTier, EXPRESSION_TIERS)
    ) {
        return null;
    }

    const expressionLanes = normalizeExpressionLanes(properties.expressionLanes);
    const mpe = normalizeMpe(properties.mpe);
    if (!expressionLanes || !mpe) {
        return null;
    }

    const normalized = {
        schemaVersion: 1 as const,
        instrumentId: properties.instrumentId,
        semanticsRevision: properties.semanticsRevision,
        expressionLanes,
        tuningModel: properties.tuningModel,
        channelModel: properties.channelModel,
        mpe,
        articulationSwitching: properties.articulationSwitching,
        drumMap: properties.drumMap,
        expressionTier: properties.expressionTier,
    };
    if (!hasCoherentModels(normalized)) {
        return null;
    }
    return Object.freeze(normalized);
}

export function normalizeRegisteredInstrumentCapabilities(value: unknown): RegisteredInstrumentCapabilities | null {
    const properties = readDataObject(value, REGISTERED_DESCRIPTOR_KEYS);
    if (!properties || properties.availability !== 'registered') {
        return null;
    }
    const normalized = normalizeInstrumentCapabilitiesDescriptor({
        schemaVersion: properties.schemaVersion,
        instrumentId: properties.instrumentId,
        semanticsRevision: properties.semanticsRevision,
        expressionLanes: properties.expressionLanes,
        tuningModel: properties.tuningModel,
        channelModel: properties.channelModel,
        mpe: properties.mpe,
        articulationSwitching: properties.articulationSwitching,
        drumMap: properties.drumMap,
        expressionTier: properties.expressionTier,
    });
    if (!normalized) {
        return null;
    }
    return Object.freeze({
        ...normalized,
        availability: 'registered',
    });
}

export function createGenericInstrumentCapabilities(instrumentId: string): GenericInstrumentCapabilities {
    return Object.freeze({
        availability: 'unavailable',
        unavailableReason: 'unknown-or-incompatible',
        schemaVersion: 1,
        instrumentId,
        semanticsRevision: 0,
        expressionLanes: Object.freeze([] as const),
        tuningModel: 'unavailable',
        channelModel: 'unavailable',
        mpe: Object.freeze({
            zone: 'none',
            memberChannels: 0,
            maxVoices: 0,
        }),
        articulationSwitching: 'none',
        drumMap: 'none',
        expressionTier: 'none',
    });
}
