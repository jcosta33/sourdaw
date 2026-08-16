import {
    sanitize_tempo_map_state,
    MIN_TEMPO_MAP_TEMPO,
    MAX_TEMPO_MAP_TEMPO,
    type TempoChange,
    type TempoMapStoreState,
} from '../../stores/tempoMapStore';
import {
    sanitize_time_signature_map_state,
    type TimeSignatureChange,
    type TimeSignatureMapStoreState,
} from '../../stores/timeSignatureMapStore';

type EncodedNumber =
    | {
          type: 'number';
          value: number;
      }
    | {
          type: 'negative-zero';
      };

type EncodedTempoChange = {
    id: string;
    beat: EncodedNumber;
    tempo: EncodedNumber;
    curve: TempoChange['curve'];
};

type EncodedTimeSignatureChange = {
    id: string;
    beat: EncodedNumber;
    numerator: EncodedNumber;
    denominator: EncodedNumber;
};

type TimelineMapTimeStateSnapshot = {
    tempo: {
        changes: EncodedTempoChange[];
    };
    timeSignature: {
        changes: EncodedTimeSignatureChange[];
    };
};

type DecodedTimelineMapTimeState = {
    tempoState: TempoMapStoreState;
    timeSignatureState: TimeSignatureMapStoreState;
};

type EncodeTimelineMapTimeStateInput = {
    tempoState: TempoMapStoreState;
    timeSignatureState: TimeSignatureMapStoreState;
};

type StateMatchesSnapshotInput = EncodeTimelineMapTimeStateInput & {
    snapshot: TimelineMapTimeStateSnapshot;
};

type ReadTempoChangeResult = {
    runtime: TempoChange;
    encoded: EncodedTempoChange;
};

type ReadTimeSignatureChangeResult = {
    runtime: TimeSignatureChange;
    encoded: EncodedTimeSignatureChange;
};

const MIN_TIME_SIGNATURE_PART = 1;
const MAX_TIME_SIGNATURE_PART = 32;

function readDataObject(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
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
        Object.defineProperty(properties, ownKey, {
            configurable: true,
            enumerable: true,
            value: descriptor.value,
            writable: true,
        });
    }

    return properties;
}

function readDenseDataArray(value: unknown): readonly unknown[] | null {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
        return null;
    }

    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
        return null;
    }

    const entries: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
            return null;
        }
        entries.push(descriptor.value);
    }

    return entries;
}

function encodeNumber(value: unknown): EncodedNumber | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    if (Object.is(value, -0)) {
        return { type: 'negative-zero' };
    }
    return { type: 'number', value };
}

function decodeNumber(value: unknown): number | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    const typeDescriptor = Object.getOwnPropertyDescriptor(value, 'type');
    if (!typeDescriptor || !Object.hasOwn(typeDescriptor, 'value')) {
        return null;
    }

    if (typeDescriptor.value === 'negative-zero') {
        if (!readDataObject(value, ['type'])) {
            return null;
        }
        return -0;
    }
    if (typeDescriptor.value !== 'number') {
        return null;
    }

    const properties = readDataObject(value, ['type', 'value']);
    if (
        !properties ||
        typeof properties.value !== 'number' ||
        !Number.isFinite(properties.value) ||
        Object.is(properties.value, -0)
    ) {
        return null;
    }
    return properties.value;
}

function readTempoChange(value: unknown): ReadTempoChangeResult | null {
    const properties = readDataObject(value, ['id', 'beat', 'tempo', 'curve']);
    if (
        !properties ||
        typeof properties.id !== 'string' ||
        typeof properties.beat !== 'number' ||
        !Number.isFinite(properties.beat) ||
        properties.beat < 0 ||
        typeof properties.tempo !== 'number' ||
        !Number.isFinite(properties.tempo) ||
        properties.tempo < MIN_TEMPO_MAP_TEMPO ||
        properties.tempo > MAX_TEMPO_MAP_TEMPO ||
        (properties.curve !== 'instant' && properties.curve !== 'linear')
    ) {
        return null;
    }

    const encodedBeat = encodeNumber(properties.beat);
    const encodedTempo = encodeNumber(properties.tempo);
    if (!encodedBeat || !encodedTempo) {
        return null;
    }

    const runtime: TempoChange = {
        id: properties.id,
        beat: properties.beat,
        tempo: properties.tempo,
        curve: properties.curve,
    };
    return {
        runtime,
        encoded: {
            id: runtime.id,
            beat: encodedBeat,
            tempo: encodedTempo,
            curve: runtime.curve,
        },
    };
}

function readTimeSignatureChange(value: unknown): ReadTimeSignatureChangeResult | null {
    const properties = readDataObject(value, ['id', 'beat', 'numerator', 'denominator']);
    if (
        !properties ||
        typeof properties.id !== 'string' ||
        typeof properties.beat !== 'number' ||
        !Number.isFinite(properties.beat) ||
        properties.beat < 0 ||
        typeof properties.numerator !== 'number' ||
        !Number.isInteger(properties.numerator) ||
        properties.numerator < MIN_TIME_SIGNATURE_PART ||
        properties.numerator > MAX_TIME_SIGNATURE_PART ||
        typeof properties.denominator !== 'number' ||
        !Number.isInteger(properties.denominator) ||
        properties.denominator < MIN_TIME_SIGNATURE_PART ||
        properties.denominator > MAX_TIME_SIGNATURE_PART
    ) {
        return null;
    }

    const encodedBeat = encodeNumber(properties.beat);
    const encodedNumerator = encodeNumber(properties.numerator);
    const encodedDenominator = encodeNumber(properties.denominator);
    if (!encodedBeat || !encodedNumerator || !encodedDenominator) {
        return null;
    }

    const runtime: TimeSignatureChange = {
        id: properties.id,
        beat: properties.beat,
        numerator: properties.numerator,
        denominator: properties.denominator,
    };
    return {
        runtime,
        encoded: {
            id: runtime.id,
            beat: encodedBeat,
            numerator: encodedNumerator,
            denominator: encodedDenominator,
        },
    };
}

function encodeTempoState(value: unknown): TimelineMapTimeStateSnapshot['tempo'] | null {
    const properties = readDataObject(value, ['changes']);
    if (!properties) {
        return null;
    }
    const changes = readDenseDataArray(properties.changes);
    if (!changes) {
        return null;
    }

    const runtimeChanges: TempoChange[] = [];
    const encodedChanges: EncodedTempoChange[] = [];
    for (const change of changes) {
        const result = readTempoChange(change);
        if (!result) {
            return null;
        }
        runtimeChanges.push(result.runtime);
        encodedChanges.push(result.encoded);
    }

    const runtimeState: TempoMapStoreState = { changes: runtimeChanges };
    if (sanitize_tempo_map_state(runtimeState) !== runtimeState) {
        return null;
    }
    return { changes: encodedChanges };
}

function encodeTimeSignatureState(value: unknown): TimelineMapTimeStateSnapshot['timeSignature'] | null {
    const properties = readDataObject(value, ['changes']);
    if (!properties) {
        return null;
    }
    const changes = readDenseDataArray(properties.changes);
    if (!changes) {
        return null;
    }

    const runtimeChanges: TimeSignatureChange[] = [];
    const encodedChanges: EncodedTimeSignatureChange[] = [];
    for (const change of changes) {
        const result = readTimeSignatureChange(change);
        if (!result) {
            return null;
        }
        runtimeChanges.push(result.runtime);
        encodedChanges.push(result.encoded);
    }

    const runtimeState: TimeSignatureMapStoreState = { changes: runtimeChanges };
    if (sanitize_time_signature_map_state(runtimeState) !== runtimeState) {
        return null;
    }
    return { changes: encodedChanges };
}

function encodeStateUnchecked({
    tempoState,
    timeSignatureState,
}: EncodeTimelineMapTimeStateInput): TimelineMapTimeStateSnapshot | null {
    const tempo = encodeTempoState(tempoState);
    const timeSignature = encodeTimeSignatureState(timeSignatureState);
    if (!tempo || !timeSignature) {
        return null;
    }
    return { tempo, timeSignature };
}

function encodeState(input: EncodeTimelineMapTimeStateInput): TimelineMapTimeStateSnapshot | null {
    try {
        return encodeStateUnchecked(input);
    } catch {
        return null;
    }
}

function decodeTempoChange(value: unknown): TempoChange | null {
    const properties = readDataObject(value, ['id', 'beat', 'tempo', 'curve']);
    if (
        !properties ||
        typeof properties.id !== 'string' ||
        (properties.curve !== 'instant' && properties.curve !== 'linear')
    ) {
        return null;
    }

    const beat = decodeNumber(properties.beat);
    const tempo = decodeNumber(properties.tempo);
    if (beat === null || beat < 0 || tempo === null || tempo < MIN_TEMPO_MAP_TEMPO || tempo > MAX_TEMPO_MAP_TEMPO) {
        return null;
    }
    return {
        id: properties.id,
        beat,
        tempo,
        curve: properties.curve,
    };
}

function decodeTimeSignatureChange(value: unknown): TimeSignatureChange | null {
    const properties = readDataObject(value, ['id', 'beat', 'numerator', 'denominator']);
    if (!properties || typeof properties.id !== 'string') {
        return null;
    }

    const beat = decodeNumber(properties.beat);
    const numerator = decodeNumber(properties.numerator);
    const denominator = decodeNumber(properties.denominator);
    if (
        beat === null ||
        beat < 0 ||
        numerator === null ||
        !Number.isInteger(numerator) ||
        numerator < MIN_TIME_SIGNATURE_PART ||
        numerator > MAX_TIME_SIGNATURE_PART ||
        denominator === null ||
        !Number.isInteger(denominator) ||
        denominator < MIN_TIME_SIGNATURE_PART ||
        denominator > MAX_TIME_SIGNATURE_PART
    ) {
        return null;
    }
    return {
        id: properties.id,
        beat,
        numerator,
        denominator,
    };
}

function decodeTempoState(value: unknown): TempoMapStoreState | null {
    const properties = readDataObject(value, ['changes']);
    if (!properties) {
        return null;
    }
    const encodedChanges = readDenseDataArray(properties.changes);
    if (!encodedChanges) {
        return null;
    }

    const changes: TempoChange[] = [];
    for (const encodedChange of encodedChanges) {
        const change = decodeTempoChange(encodedChange);
        if (!change) {
            return null;
        }
        changes.push(change);
    }

    const state: TempoMapStoreState = { changes };
    if (sanitize_tempo_map_state(state) !== state) {
        return null;
    }
    return state;
}

function decodeTimeSignatureState(value: unknown): TimeSignatureMapStoreState | null {
    const properties = readDataObject(value, ['changes']);
    if (!properties) {
        return null;
    }
    const encodedChanges = readDenseDataArray(properties.changes);
    if (!encodedChanges) {
        return null;
    }

    const changes: TimeSignatureChange[] = [];
    for (const encodedChange of encodedChanges) {
        const change = decodeTimeSignatureChange(encodedChange);
        if (!change) {
            return null;
        }
        changes.push(change);
    }

    const state: TimeSignatureMapStoreState = { changes };
    if (sanitize_time_signature_map_state(state) !== state) {
        return null;
    }
    return state;
}

function decodeStateUnchecked(value: unknown): DecodedTimelineMapTimeState | null {
    const properties = readDataObject(value, ['tempo', 'timeSignature']);
    if (!properties) {
        return null;
    }

    const tempoState = decodeTempoState(properties.tempo);
    const timeSignatureState = decodeTimeSignatureState(properties.timeSignature);
    if (!tempoState || !timeSignatureState) {
        return null;
    }
    return { tempoState, timeSignatureState };
}

function decodeState(value: unknown): DecodedTimelineMapTimeState | null {
    try {
        return decodeStateUnchecked(value);
    } catch {
        return null;
    }
}

function encodedNumbersEqual(left: EncodedNumber, right: EncodedNumber): boolean {
    if (left.type !== right.type) {
        return false;
    }
    if (left.type === 'negative-zero' && right.type === 'negative-zero') {
        return true;
    }
    if (left.type === 'number' && right.type === 'number') {
        return Object.is(left.value, right.value);
    }
    return false;
}

function tempoSnapshotsEqual(
    left: TimelineMapTimeStateSnapshot['tempo'],
    right: TimelineMapTimeStateSnapshot['tempo']
): boolean {
    if (left.changes.length !== right.changes.length) {
        return false;
    }
    for (let index = 0; index < left.changes.length; index += 1) {
        const leftChange = left.changes[index];
        const rightChange = right.changes[index];
        if (
            !leftChange ||
            !rightChange ||
            leftChange.id !== rightChange.id ||
            leftChange.curve !== rightChange.curve ||
            !encodedNumbersEqual(leftChange.beat, rightChange.beat) ||
            !encodedNumbersEqual(leftChange.tempo, rightChange.tempo)
        ) {
            return false;
        }
    }
    return true;
}

function timeSignatureSnapshotsEqual(
    left: TimelineMapTimeStateSnapshot['timeSignature'],
    right: TimelineMapTimeStateSnapshot['timeSignature']
): boolean {
    if (left.changes.length !== right.changes.length) {
        return false;
    }
    for (let index = 0; index < left.changes.length; index += 1) {
        const leftChange = left.changes[index];
        const rightChange = right.changes[index];
        if (
            !leftChange ||
            !rightChange ||
            leftChange.id !== rightChange.id ||
            !encodedNumbersEqual(leftChange.beat, rightChange.beat) ||
            !encodedNumbersEqual(leftChange.numerator, rightChange.numerator) ||
            !encodedNumbersEqual(leftChange.denominator, rightChange.denominator)
        ) {
            return false;
        }
    }
    return true;
}

function snapshotsEqual(left: TimelineMapTimeStateSnapshot, right: TimelineMapTimeStateSnapshot): boolean {
    return (
        tempoSnapshotsEqual(left.tempo, right.tempo) &&
        timeSignatureSnapshotsEqual(left.timeSignature, right.timeSignature)
    );
}

function stateMatchesSnapshot({ tempoState, timeSignatureState, snapshot }: StateMatchesSnapshotInput): boolean {
    const encodedState = encodeState({ tempoState, timeSignatureState });
    if (!encodedState) {
        return false;
    }
    return snapshotsEqual(encodedState, snapshot);
}

export const timelineMapTimeStateCodec = {
    decodeState,
    encodeState,
    snapshotsEqual,
    stateMatchesSnapshot,
    tempoSnapshotsEqual,
    timeSignatureSnapshotsEqual,
};
