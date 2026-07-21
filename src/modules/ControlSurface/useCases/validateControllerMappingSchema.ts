import type { AppAction } from '#/utils/handlerContract';
import type {
    ControllerActionTemplateV1,
    ControllerActionValueV1,
    ControllerBehaviorV1,
    ControllerCurveV1,
    ControllerFeedbackV1,
    ControllerInputV1,
    ControllerIntegerRangeV1,
    ControllerMappingSchemaV1,
    ControllerMappingV1,
    CurrentTargetResolverV1,
} from '../models/ControllerMappingSchema';

type ControllerMappingSchemaDiagnosticCode =
    | 'INVALID_SCHEMA_VERSION'
    | 'INVALID_SHAPE'
    | 'UNKNOWN_KEY'
    | 'INVALID_ID'
    | 'INVALID_RANGE'
    | 'MUTUALLY_EXCLUSIVE_SCOPE'
    | 'INVALID_BEHAVIOR'
    | 'INVALID_CURVE'
    | 'INVALID_FEEDBACK'
    | 'DUPLICATE_MAPPING_ID'
    | 'OVERLAPPING_INPUT'
    | 'UNRESOLVED_ACTION';

type ControllerMappingSchemaDiagnostic = Readonly<{
    code: ControllerMappingSchemaDiagnosticCode;
    path: string;
}>;

type ControllerActionTemplateCandidateV1 = Readonly<{
    type: string;
    payload: Readonly<Record<string, ControllerActionValueV1>> | null;
}>;

type ResolveControllerActionTemplateInput = Readonly<{
    action: ControllerActionTemplateCandidateV1;
    input: ControllerInputV1;
}>;

type ResolveControllerActionTemplateOutput =
    | Readonly<{
          status: 'resolved';
          actionType: AppAction['type'];
      }>
    | Readonly<{
          status: 'unresolved';
          reason: string;
      }>;

type ValidateControllerMappingSchemaInput = Readonly<{
    value: unknown;
    resolveActionTemplate: (input: ResolveControllerActionTemplateInput) => ResolveControllerActionTemplateOutput;
}>;

type ValidateControllerMappingSchemaOutput =
    | Readonly<{
          status: 'valid';
          value: ControllerMappingSchemaV1;
      }>
    | Readonly<{
          status: 'invalid';
          diagnostics: readonly ControllerMappingSchemaDiagnostic[];
      }>;

type ParseSuccess<Value> = Readonly<{
    status: 'valid';
    value: Value;
}>;

type ParseFailure = Readonly<{
    status: 'invalid';
    diagnostic: ControllerMappingSchemaDiagnostic;
}>;

type ParseResult<Value> = ParseSuccess<Value> | ParseFailure;

type ExactRecord = Readonly<Record<string, unknown>>;

type ParsedMappingCandidate = Readonly<{
    id: string;
    input: ControllerInputV1;
    action: ControllerActionTemplateCandidateV1;
    behavior: ControllerBehaviorV1;
    curve: ControllerCurveV1;
    feedback?: ControllerFeedbackV1;
    layer?: string;
    mode?: string;
}>;

const INPUT_KINDS = new Set(['note', 'cc', 'pitch-bend', 'channel-pressure', 'relative-encoder', 'button-edge']);

function success<Value>(value: Value): ParseSuccess<Value> {
    return { status: 'valid', value };
}

function failure(code: ControllerMappingSchemaDiagnosticCode, path: string): ParseFailure {
    return {
        status: 'invalid',
        diagnostic: { code, path },
    };
}

function propertyPath(path: string, key: string): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/u.test(key)) {
        return `${path}.${key}`;
    }

    return `${path}[${JSON.stringify(key)}]`;
}

function defineOwnDataProperty<Value>(record: Record<string, Value>, key: string, value: Value): void {
    Object.defineProperty(record, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    });
}

function readExactRecord(
    value: unknown,
    allowedKeys: readonly string[],
    requiredKeys: readonly string[],
    path: string,
    invalidCode: ControllerMappingSchemaDiagnosticCode = 'INVALID_SHAPE',
    unknownCode: ControllerMappingSchemaDiagnosticCode = 'UNKNOWN_KEY'
): ParseResult<ExactRecord> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return failure(invalidCode, path);
    }

    let prototype: object | null;
    let keys: readonly PropertyKey[];
    let descriptors: Record<string, PropertyDescriptor>;
    try {
        prototype = Object.getPrototypeOf(value);
        keys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return failure(invalidCode, path);
    }

    if (prototype !== Object.prototype) {
        return failure(invalidCode, path);
    }

    const allowed = new Set(allowedKeys);
    for (const key of keys) {
        if (typeof key !== 'string') {
            return failure(unknownCode, `${path}[symbol]`);
        }

        if (!allowed.has(key)) {
            return failure(unknownCode, propertyPath(path, key));
        }

        const descriptor = descriptors[key];
        if (descriptor === undefined || !('value' in descriptor)) {
            return failure(invalidCode, propertyPath(path, key));
        }
    }

    for (const key of requiredKeys) {
        if (descriptors[key] === undefined) {
            return failure(invalidCode, propertyPath(path, key));
        }
    }

    const record: Record<string, unknown> = {};
    for (const key of allowedKeys) {
        const descriptor = descriptors[key];
        if (descriptor !== undefined && 'value' in descriptor) {
            defineOwnDataProperty(record, key, descriptor.value);
        }
    }

    return success(Object.freeze(record));
}

function readExactArray(value: unknown, path: string): ParseResult<readonly unknown[]> {
    if (!Array.isArray(value)) {
        return failure('INVALID_SHAPE', path);
    }

    let prototype: object | null;
    let keys: readonly PropertyKey[];
    let descriptors: Record<string, PropertyDescriptor>;
    try {
        prototype = Object.getPrototypeOf(value);
        keys = Reflect.ownKeys(value);
        descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
        return failure('INVALID_SHAPE', path);
    }

    if (prototype !== Array.prototype) {
        return failure('INVALID_SHAPE', path);
    }

    const lengthDescriptor = descriptors.length;
    if (lengthDescriptor === undefined || !('value' in lengthDescriptor)) {
        return failure('INVALID_SHAPE', path);
    }

    const length = lengthDescriptor.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
        return failure('INVALID_SHAPE', path);
    }

    for (const key of keys) {
        if (key === 'length') {
            continue;
        }

        if (typeof key !== 'string') {
            return failure('UNKNOWN_KEY', `${path}[symbol]`);
        }

        const index = Number(key);
        const isCanonicalIndex = Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
        if (!isCanonicalIndex) {
            return failure('UNKNOWN_KEY', propertyPath(path, key));
        }

        const descriptor = descriptors[key];
        if (descriptor === undefined || !('value' in descriptor)) {
            return failure('INVALID_SHAPE', `${path}[${key}]`);
        }
    }

    const items: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !('value' in descriptor)) {
            return failure('INVALID_SHAPE', `${path}[${index}]`);
        }

        items.push(descriptor.value);
    }

    return success(Object.freeze(items));
}

function parseStableId(value: unknown, path: string): ParseResult<string> {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
        return failure('INVALID_ID', path);
    }

    return success(value);
}

function parseInteger(
    value: unknown,
    minimum: number,
    maximum: number,
    path: string,
    code: ControllerMappingSchemaDiagnosticCode = 'INVALID_RANGE'
): ParseResult<number> {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
        return failure(code, path);
    }

    return success(value);
}

function parseFiniteAbove(
    value: unknown,
    exclusiveMinimum: number,
    path: string,
    code: ControllerMappingSchemaDiagnosticCode
): ParseResult<number> {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= exclusiveMinimum) {
        return failure(code, path);
    }

    return success(value);
}

function parseIntegerRange(
    value: unknown,
    minimum: number,
    maximum: number,
    path: string,
    code: ControllerMappingSchemaDiagnosticCode = 'INVALID_RANGE'
): ParseResult<ControllerIntegerRangeV1> {
    const record = readExactRecord(value, ['min', 'max'], ['min', 'max'], path, code, 'UNKNOWN_KEY');
    if (record.status === 'invalid') {
        return record;
    }

    const min = parseInteger(record.value.min, minimum, maximum, `${path}.min`, code);
    if (min.status === 'invalid') {
        return min;
    }

    const max = parseInteger(record.value.max, minimum, maximum, `${path}.max`, code);
    if (max.status === 'invalid') {
        return max;
    }

    if (min.value > max.value) {
        return failure(code, path);
    }

    return success(Object.freeze({ min: min.value, max: max.value }));
}

function parseInput(value: unknown, path: string): ParseResult<ControllerInputV1> {
    const discriminated = readExactRecord(
        value,
        ['kind', 'source', 'channel', 'note', 'controller', 'encoding', 'number', 'value', 'edge'],
        ['kind'],
        path
    );
    if (discriminated.status === 'invalid') {
        return discriminated;
    }

    const kind = discriminated.value.kind;
    if (typeof kind !== 'string' || !INPUT_KINDS.has(kind)) {
        return failure('INVALID_SHAPE', `${path}.kind`);
    }

    if (kind === 'note') {
        const record = readExactRecord(
            value,
            ['kind', 'channel', 'note', 'value'],
            ['kind', 'channel', 'note', 'value'],
            path
        );
        if (record.status === 'invalid') {
            return record;
        }

        const channel = parseInteger(record.value.channel, 1, 16, `${path}.channel`);
        if (channel.status === 'invalid') {
            return channel;
        }
        const note = parseInteger(record.value.note, 0, 127, `${path}.note`);
        if (note.status === 'invalid') {
            return note;
        }
        const range = parseIntegerRange(record.value.value, 0, 127, `${path}.value`);
        if (range.status === 'invalid') {
            return range;
        }

        return success(Object.freeze({ kind, channel: channel.value, note: note.value, value: range.value }));
    }

    if (kind === 'cc') {
        const record = readExactRecord(
            value,
            ['kind', 'channel', 'controller', 'value'],
            ['kind', 'channel', 'controller', 'value'],
            path
        );
        if (record.status === 'invalid') {
            return record;
        }

        const channel = parseInteger(record.value.channel, 1, 16, `${path}.channel`);
        if (channel.status === 'invalid') {
            return channel;
        }
        const controller = parseInteger(record.value.controller, 0, 127, `${path}.controller`);
        if (controller.status === 'invalid') {
            return controller;
        }
        const range = parseIntegerRange(record.value.value, 0, 127, `${path}.value`);
        if (range.status === 'invalid') {
            return range;
        }

        return success(
            Object.freeze({ kind, channel: channel.value, controller: controller.value, value: range.value })
        );
    }

    if (kind === 'pitch-bend' || kind === 'channel-pressure') {
        const record = readExactRecord(value, ['kind', 'channel', 'value'], ['kind', 'channel', 'value'], path);
        if (record.status === 'invalid') {
            return record;
        }

        const channel = parseInteger(record.value.channel, 1, 16, `${path}.channel`);
        if (channel.status === 'invalid') {
            return channel;
        }
        const maximum = kind === 'pitch-bend' ? 16_383 : 127;
        const range = parseIntegerRange(record.value.value, 0, maximum, `${path}.value`);
        if (range.status === 'invalid') {
            return range;
        }

        return success(Object.freeze({ kind, channel: channel.value, value: range.value }));
    }

    if (kind === 'relative-encoder') {
        const record = readExactRecord(
            value,
            ['kind', 'channel', 'controller', 'encoding', 'value'],
            ['kind', 'channel', 'controller', 'encoding', 'value'],
            path
        );
        if (record.status === 'invalid') {
            return record;
        }

        const channel = parseInteger(record.value.channel, 1, 16, `${path}.channel`);
        if (channel.status === 'invalid') {
            return channel;
        }
        const controller = parseInteger(record.value.controller, 0, 127, `${path}.controller`);
        if (controller.status === 'invalid') {
            return controller;
        }
        const encoding = record.value.encoding;
        if (encoding !== 'binary-offset' && encoding !== "two's-complement" && encoding !== 'signed-bit') {
            return failure('INVALID_SHAPE', `${path}.encoding`);
        }
        const range = parseIntegerRange(record.value.value, 0, 127, `${path}.value`);
        if (range.status === 'invalid') {
            return range;
        }

        return success(
            Object.freeze({
                kind,
                channel: channel.value,
                controller: controller.value,
                encoding,
                value: range.value,
            })
        );
    }

    const record = readExactRecord(
        value,
        ['kind', 'source', 'channel', 'number', 'value', 'edge'],
        ['kind', 'source', 'channel', 'number', 'value', 'edge'],
        path
    );
    if (record.status === 'invalid') {
        return record;
    }

    const source = record.value.source;
    if (source !== 'note' && source !== 'cc') {
        return failure('INVALID_SHAPE', `${path}.source`);
    }
    const channel = parseInteger(record.value.channel, 1, 16, `${path}.channel`);
    if (channel.status === 'invalid') {
        return channel;
    }
    const number = parseInteger(record.value.number, 0, 127, `${path}.number`);
    if (number.status === 'invalid') {
        return number;
    }
    const edgeValue = parseInteger(record.value.value, 0, 127, `${path}.value`);
    if (edgeValue.status === 'invalid') {
        return edgeValue;
    }
    const edge = record.value.edge;
    if (edge !== 'press' && edge !== 'release') {
        return failure('INVALID_SHAPE', `${path}.edge`);
    }

    return success(
        Object.freeze({
            kind: 'button-edge',
            source,
            channel: channel.value,
            number: number.value,
            value: edgeValue.value,
            edge,
        })
    );
}

function parseCurrentTargetResolver(value: unknown, path: string): ParseResult<CurrentTargetResolverV1> {
    const discriminated = readExactRecord(
        value,
        ['kind', 'slot'],
        ['kind'],
        path,
        'UNRESOLVED_ACTION',
        'UNRESOLVED_ACTION'
    );
    if (discriminated.status === 'invalid') {
        return discriminated;
    }

    const kind = discriminated.value.kind;
    if (kind === 'selected-track-id' || kind === 'focused-clip-id' || kind === 'selected-device-id') {
        const record = readExactRecord(value, ['kind'], ['kind'], path, 'UNRESOLVED_ACTION', 'UNRESOLVED_ACTION');
        if (record.status === 'invalid') {
            return record;
        }

        return success(Object.freeze({ kind }));
    }

    if (kind === 'track-bank-slot-id' || kind === 'selected-device-parameter-id' || kind === 'selected-send-id') {
        const record = readExactRecord(
            value,
            ['kind', 'slot'],
            ['kind', 'slot'],
            path,
            'UNRESOLVED_ACTION',
            'UNRESOLVED_ACTION'
        );
        if (record.status === 'invalid') {
            return record;
        }

        const slot = parseInteger(record.value.slot, 0, 7, `${path}.slot`, 'UNRESOLVED_ACTION');
        if (slot.status === 'invalid') {
            return slot;
        }

        return success(Object.freeze({ kind, slot: slot.value }));
    }

    return failure('UNRESOLVED_ACTION', `${path}.kind`);
}

function parseActionValue(
    value: unknown,
    path: string,
    input: ControllerInputV1
): ParseResult<ControllerActionValueV1> {
    const discriminated = readExactRecord(
        value,
        ['source', 'value', 'resolver'],
        ['source'],
        path,
        'UNRESOLVED_ACTION',
        'UNRESOLVED_ACTION'
    );
    if (discriminated.status === 'invalid') {
        return discriminated;
    }

    const source = discriminated.value.source;
    if (source === 'constant') {
        const record = readExactRecord(
            value,
            ['source', 'value'],
            ['source', 'value'],
            path,
            'UNRESOLVED_ACTION',
            'UNRESOLVED_ACTION'
        );
        if (record.status === 'invalid') {
            return record;
        }

        const constant = record.value.value;
        const isStringBooleanOrNull =
            typeof constant === 'string' || typeof constant === 'boolean' || constant === null;
        const isFiniteNumber = typeof constant === 'number' && Number.isFinite(constant);
        if (!isStringBooleanOrNull && !isFiniteNumber) {
            return failure('UNRESOLVED_ACTION', `${path}.value`);
        }

        return success(Object.freeze({ source, value: constant }));
    }

    if (source === 'input-value') {
        const record = readExactRecord(value, ['source'], ['source'], path, 'UNRESOLVED_ACTION', 'UNRESOLVED_ACTION');
        if (record.status === 'invalid') {
            return record;
        }

        return success(Object.freeze({ source }));
    }

    if (source === 'button-state') {
        const record = readExactRecord(value, ['source'], ['source'], path, 'UNRESOLVED_ACTION', 'UNRESOLVED_ACTION');
        if (record.status === 'invalid') {
            return record;
        }

        if (input.kind !== 'button-edge') {
            return failure('UNRESOLVED_ACTION', path);
        }

        return success(Object.freeze({ source }));
    }

    if (source === 'current-target') {
        const record = readExactRecord(
            value,
            ['source', 'resolver'],
            ['source', 'resolver'],
            path,
            'UNRESOLVED_ACTION',
            'UNRESOLVED_ACTION'
        );
        if (record.status === 'invalid') {
            return record;
        }

        const resolver = parseCurrentTargetResolver(record.value.resolver, `${path}.resolver`);
        if (resolver.status === 'invalid') {
            return resolver;
        }

        return success(Object.freeze({ source, resolver: resolver.value }));
    }

    return failure('UNRESOLVED_ACTION', `${path}.source`);
}

function parseActionCandidate(
    value: unknown,
    input: ControllerInputV1,
    path: string
): ParseResult<ControllerActionTemplateCandidateV1> {
    const record = readExactRecord(
        value,
        ['type', 'payload'],
        ['type', 'payload'],
        path,
        'UNRESOLVED_ACTION',
        'UNRESOLVED_ACTION'
    );
    if (record.status === 'invalid') {
        return record;
    }

    const type = record.value.type;
    if (typeof type !== 'string' || type.length === 0 || type.trim() !== type) {
        return failure('UNRESOLVED_ACTION', `${path}.type`);
    }

    if (record.value.payload === null) {
        return success(Object.freeze({ type, payload: null }));
    }

    const payloadRecord = readExactRecord(
        record.value.payload,
        getOwnStringKeys(record.value.payload),
        [],
        `${path}.payload`,
        'UNRESOLVED_ACTION',
        'UNRESOLVED_ACTION'
    );
    if (payloadRecord.status === 'invalid') {
        return payloadRecord;
    }

    const payload: Record<string, ControllerActionValueV1> = {};
    for (const [key, actionValue] of Object.entries(payloadRecord.value)) {
        const stableKey = parseStableId(key, propertyPath(`${path}.payload`, key));
        if (stableKey.status === 'invalid') {
            return failure('UNRESOLVED_ACTION', stableKey.diagnostic.path);
        }

        const parsedValue = parseActionValue(actionValue, propertyPath(`${path}.payload`, key), input);
        if (parsedValue.status === 'invalid') {
            return parsedValue;
        }

        defineOwnDataProperty(payload, key, parsedValue.value);
    }

    return success(Object.freeze({ type, payload: Object.freeze(payload) }));
}

function getOwnStringKeys(value: unknown): readonly string[] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return [];
    }

    try {
        const keys = Reflect.ownKeys(value);
        const stringKeys: string[] = [];
        for (const key of keys) {
            if (typeof key === 'string') {
                stringKeys.push(key);
            }
        }
        return stringKeys;
    } catch {
        return [];
    }
}

function parseBehavior(value: unknown, path: string): ParseResult<ControllerBehaviorV1> {
    const discriminated = readExactRecord(
        value,
        ['kind', 'sensitivity', 'acceleration'],
        ['kind'],
        path,
        'INVALID_BEHAVIOR'
    );
    if (discriminated.status === 'invalid') {
        return discriminated;
    }

    const kind = discriminated.value.kind;
    if (kind === 'jump' || kind === 'pickup' || kind === 'scaled-pickup') {
        const record = readExactRecord(value, ['kind'], ['kind'], path, 'INVALID_BEHAVIOR');
        if (record.status === 'invalid') {
            return record;
        }

        return success(Object.freeze({ kind }));
    }

    if (kind !== 'relative') {
        return failure('INVALID_BEHAVIOR', `${path}.kind`);
    }

    const record = readExactRecord(
        value,
        ['kind', 'sensitivity', 'acceleration'],
        ['kind', 'sensitivity', 'acceleration'],
        path,
        'INVALID_BEHAVIOR'
    );
    if (record.status === 'invalid') {
        return record;
    }

    const sensitivity = parseFiniteAbove(record.value.sensitivity, 0, `${path}.sensitivity`, 'INVALID_BEHAVIOR');
    if (sensitivity.status === 'invalid') {
        return sensitivity;
    }

    const acceleration = readExactRecord(
        record.value.acceleration,
        ['kind', 'factor'],
        ['kind'],
        `${path}.acceleration`,
        'INVALID_BEHAVIOR'
    );
    if (acceleration.status === 'invalid') {
        return acceleration;
    }

    const accelerationKind = acceleration.value.kind;
    if (accelerationKind === 'none') {
        const exact = readExactRecord(
            record.value.acceleration,
            ['kind'],
            ['kind'],
            `${path}.acceleration`,
            'INVALID_BEHAVIOR'
        );
        if (exact.status === 'invalid') {
            return exact;
        }

        return success(
            Object.freeze({
                kind,
                sensitivity: sensitivity.value,
                acceleration: Object.freeze({ kind: accelerationKind }),
            })
        );
    }

    if (accelerationKind !== 'linear') {
        return failure('INVALID_BEHAVIOR', `${path}.acceleration.kind`);
    }

    const exact = readExactRecord(
        record.value.acceleration,
        ['kind', 'factor'],
        ['kind', 'factor'],
        `${path}.acceleration`,
        'INVALID_BEHAVIOR'
    );
    if (exact.status === 'invalid') {
        return exact;
    }

    const factor = parseFiniteAbove(exact.value.factor, 0, `${path}.acceleration.factor`, 'INVALID_BEHAVIOR');
    if (factor.status === 'invalid') {
        return factor;
    }
    if (factor.value < 1) {
        return failure('INVALID_BEHAVIOR', `${path}.acceleration.factor`);
    }

    return success(
        Object.freeze({
            kind,
            sensitivity: sensitivity.value,
            acceleration: Object.freeze({ kind: accelerationKind, factor: factor.value }),
        })
    );
}

function parseCurve(value: unknown, path: string): ParseResult<ControllerCurveV1> {
    const discriminated = readExactRecord(value, ['kind', 'base', 'exponent'], ['kind'], path, 'INVALID_CURVE');
    if (discriminated.status === 'invalid') {
        return discriminated;
    }

    const kind = discriminated.value.kind;
    if (kind === 'linear') {
        const exact = readExactRecord(value, ['kind'], ['kind'], path, 'INVALID_CURVE');
        if (exact.status === 'invalid') {
            return exact;
        }

        return success(Object.freeze({ kind }));
    }

    if (kind === 'log') {
        const exact = readExactRecord(value, ['kind', 'base'], ['kind', 'base'], path, 'INVALID_CURVE');
        if (exact.status === 'invalid') {
            return exact;
        }

        const base = parseFiniteAbove(exact.value.base, 1, `${path}.base`, 'INVALID_CURVE');
        if (base.status === 'invalid') {
            return base;
        }

        return success(Object.freeze({ kind, base: base.value }));
    }

    if (kind === 'exp') {
        const exact = readExactRecord(value, ['kind', 'exponent'], ['kind', 'exponent'], path, 'INVALID_CURVE');
        if (exact.status === 'invalid') {
            return exact;
        }

        const exponent = parseFiniteAbove(exact.value.exponent, 0, `${path}.exponent`, 'INVALID_CURVE');
        if (exponent.status === 'invalid') {
            return exponent;
        }

        return success(Object.freeze({ kind, exponent: exponent.value }));
    }

    return failure('INVALID_CURVE', `${path}.kind`);
}

function parseFeedback(value: unknown, path: string): ParseResult<ControllerFeedbackV1> {
    const discriminated = readExactRecord(
        value,
        ['kind', 'channel', 'note', 'offValue', 'onValue', 'controller', 'value'],
        ['kind'],
        path,
        'INVALID_FEEDBACK'
    );
    if (discriminated.status === 'invalid') {
        return discriminated;
    }

    const kind = discriminated.value.kind;
    if (kind === 'note') {
        const record = readExactRecord(
            value,
            ['kind', 'channel', 'note', 'offValue', 'onValue'],
            ['kind', 'channel', 'note', 'offValue', 'onValue'],
            path,
            'INVALID_FEEDBACK'
        );
        if (record.status === 'invalid') {
            return record;
        }

        const channel = parseInteger(record.value.channel, 1, 16, `${path}.channel`, 'INVALID_FEEDBACK');
        if (channel.status === 'invalid') {
            return channel;
        }
        const note = parseInteger(record.value.note, 0, 127, `${path}.note`, 'INVALID_FEEDBACK');
        if (note.status === 'invalid') {
            return note;
        }
        const offValue = parseInteger(record.value.offValue, 0, 127, `${path}.offValue`, 'INVALID_FEEDBACK');
        if (offValue.status === 'invalid') {
            return offValue;
        }
        const onValue = parseInteger(record.value.onValue, 0, 127, `${path}.onValue`, 'INVALID_FEEDBACK');
        if (onValue.status === 'invalid') {
            return onValue;
        }

        return success(
            Object.freeze({
                kind,
                channel: channel.value,
                note: note.value,
                offValue: offValue.value,
                onValue: onValue.value,
            })
        );
    }

    if (kind === 'cc') {
        const record = readExactRecord(
            value,
            ['kind', 'channel', 'controller', 'value'],
            ['kind', 'channel', 'controller', 'value'],
            path,
            'INVALID_FEEDBACK'
        );
        if (record.status === 'invalid') {
            return record;
        }

        const channel = parseInteger(record.value.channel, 1, 16, `${path}.channel`, 'INVALID_FEEDBACK');
        if (channel.status === 'invalid') {
            return channel;
        }
        const controller = parseInteger(record.value.controller, 0, 127, `${path}.controller`, 'INVALID_FEEDBACK');
        if (controller.status === 'invalid') {
            return controller;
        }
        const range = parseIntegerRange(record.value.value, 0, 127, `${path}.value`, 'INVALID_FEEDBACK');
        if (range.status === 'invalid') {
            return range;
        }

        return success(
            Object.freeze({ kind, channel: channel.value, controller: controller.value, value: range.value })
        );
    }

    if (kind === 'pitch-bend') {
        const record = readExactRecord(
            value,
            ['kind', 'channel', 'value'],
            ['kind', 'channel', 'value'],
            path,
            'INVALID_FEEDBACK'
        );
        if (record.status === 'invalid') {
            return record;
        }

        const channel = parseInteger(record.value.channel, 1, 16, `${path}.channel`, 'INVALID_FEEDBACK');
        if (channel.status === 'invalid') {
            return channel;
        }
        const range = parseIntegerRange(record.value.value, 0, 16_383, `${path}.value`, 'INVALID_FEEDBACK');
        if (range.status === 'invalid') {
            return range;
        }

        return success(Object.freeze({ kind, channel: channel.value, value: range.value }));
    }

    return failure('INVALID_FEEDBACK', `${path}.kind`);
}

function parseMappingCandidate(value: unknown, index: number): ParseResult<ParsedMappingCandidate> {
    const path = `$.mappings[${index}]`;
    const record = readExactRecord(
        value,
        ['id', 'input', 'action', 'behavior', 'curve', 'feedback', 'layer', 'mode'],
        ['id', 'input', 'action', 'behavior', 'curve'],
        path
    );
    if (record.status === 'invalid') {
        return record;
    }

    const id = parseStableId(record.value.id, `${path}.id`);
    if (id.status === 'invalid') {
        return id;
    }

    const hasLayer = Object.hasOwn(record.value, 'layer');
    const hasMode = Object.hasOwn(record.value, 'mode');
    if (hasLayer && hasMode) {
        return failure('MUTUALLY_EXCLUSIVE_SCOPE', path);
    }

    let layer: string | undefined;
    if (hasLayer) {
        const parsedLayer = parseStableId(record.value.layer, `${path}.layer`);
        if (parsedLayer.status === 'invalid') {
            return parsedLayer;
        }
        layer = parsedLayer.value;
    }

    let mode: string | undefined;
    if (hasMode) {
        const parsedMode = parseStableId(record.value.mode, `${path}.mode`);
        if (parsedMode.status === 'invalid') {
            return parsedMode;
        }
        mode = parsedMode.value;
    }

    const input = parseInput(record.value.input, `${path}.input`);
    if (input.status === 'invalid') {
        return input;
    }

    const action = parseActionCandidate(record.value.action, input.value, `${path}.action`);
    if (action.status === 'invalid') {
        return action;
    }

    const behavior = parseBehavior(record.value.behavior, `${path}.behavior`);
    if (behavior.status === 'invalid') {
        return behavior;
    }

    if (input.value.kind === 'relative-encoder' && behavior.value.kind !== 'relative') {
        return failure('INVALID_BEHAVIOR', `${path}.behavior`);
    }
    if (input.value.kind !== 'relative-encoder' && behavior.value.kind === 'relative') {
        return failure('INVALID_BEHAVIOR', `${path}.behavior`);
    }
    if (input.value.kind === 'button-edge' && behavior.value.kind !== 'jump') {
        return failure('INVALID_BEHAVIOR', `${path}.behavior`);
    }

    const curve = parseCurve(record.value.curve, `${path}.curve`);
    if (curve.status === 'invalid') {
        return curve;
    }

    const requiresLinearCurve = input.value.kind === 'relative-encoder' || input.value.kind === 'button-edge';
    if (requiresLinearCurve && curve.value.kind !== 'linear') {
        return failure('INVALID_CURVE', `${path}.curve`);
    }

    let feedback: ControllerFeedbackV1 | undefined;
    if (Object.hasOwn(record.value, 'feedback')) {
        const parsedFeedback = parseFeedback(record.value.feedback, `${path}.feedback`);
        if (parsedFeedback.status === 'invalid') {
            return parsedFeedback;
        }
        feedback = parsedFeedback.value;
    }

    const candidate: {
        id: string;
        input: ControllerInputV1;
        action: ControllerActionTemplateCandidateV1;
        behavior: ControllerBehaviorV1;
        curve: ControllerCurveV1;
        feedback?: ControllerFeedbackV1;
        layer?: string;
        mode?: string;
    } = {
        id: id.value,
        input: input.value,
        action: action.value,
        behavior: behavior.value,
        curve: curve.value,
    };
    if (feedback !== undefined) {
        candidate.feedback = feedback;
    }
    if (layer !== undefined) {
        candidate.layer = layer;
    }
    if (mode !== undefined) {
        candidate.mode = mode;
    }

    return success(Object.freeze(candidate));
}

function scopeIdentity(mapping: ParsedMappingCandidate): string {
    if (mapping.layer !== undefined) {
        return `layer:${mapping.layer}`;
    }
    if (mapping.mode !== undefined) {
        return `mode:${mapping.mode}`;
    }
    return 'default';
}

function rangesIntersect(first: ControllerIntegerRangeV1, second: ControllerIntegerRangeV1): boolean {
    return first.min <= second.max && second.min <= first.max;
}

function buttonOverlapsInput(
    button: Extract<ControllerInputV1, { kind: 'button-edge' }>,
    input: ControllerInputV1
): boolean {
    if (button.channel !== input.channel) {
        return false;
    }

    if (input.kind === 'note') {
        return (
            button.source === 'note' &&
            button.number === input.note &&
            button.value >= input.value.min &&
            button.value <= input.value.max
        );
    }

    if (input.kind === 'cc' || input.kind === 'relative-encoder') {
        return (
            button.source === 'cc' &&
            button.number === input.controller &&
            button.value >= input.value.min &&
            button.value <= input.value.max
        );
    }

    return false;
}

function physicalInputsOverlap(first: ControllerInputV1, second: ControllerInputV1): boolean {
    if (first.kind === 'button-edge' && second.kind === 'button-edge') {
        return (
            first.source === second.source &&
            first.channel === second.channel &&
            first.number === second.number &&
            first.value === second.value &&
            first.edge === second.edge
        );
    }

    if (first.kind === 'button-edge') {
        return buttonOverlapsInput(first, second);
    }
    if (second.kind === 'button-edge') {
        return buttonOverlapsInput(second, first);
    }

    if (first.kind === 'note' && second.kind === 'note') {
        return (
            first.channel === second.channel && first.note === second.note && rangesIntersect(first.value, second.value)
        );
    }

    const firstIsController = first.kind === 'cc' || first.kind === 'relative-encoder';
    const secondIsController = second.kind === 'cc' || second.kind === 'relative-encoder';
    if (firstIsController && secondIsController) {
        return (
            first.channel === second.channel &&
            first.controller === second.controller &&
            rangesIntersect(first.value, second.value)
        );
    }

    if (first.kind === 'pitch-bend' && second.kind === 'pitch-bend') {
        return first.channel === second.channel && rangesIntersect(first.value, second.value);
    }

    if (first.kind === 'channel-pressure' && second.kind === 'channel-pressure') {
        return first.channel === second.channel && rangesIntersect(first.value, second.value);
    }

    return false;
}

function findGlobalDiagnostics(
    mappings: readonly ParsedMappingCandidate[]
): readonly ControllerMappingSchemaDiagnostic[] {
    const diagnostics: ControllerMappingSchemaDiagnostic[] = [];
    const firstIndexById = new Map<string, number>();

    for (let index = 0; index < mappings.length; index += 1) {
        const mapping = mappings[index];
        if (mapping === undefined) {
            continue;
        }

        if (firstIndexById.has(mapping.id)) {
            diagnostics.push({ code: 'DUPLICATE_MAPPING_ID', path: `$.mappings[${index}].id` });
            continue;
        }

        firstIndexById.set(mapping.id, index);
    }

    for (let firstIndex = 0; firstIndex < mappings.length; firstIndex += 1) {
        const first = mappings[firstIndex];
        if (first === undefined) {
            continue;
        }

        for (let secondIndex = firstIndex + 1; secondIndex < mappings.length; secondIndex += 1) {
            const second = mappings[secondIndex];
            if (second === undefined || scopeIdentity(first) !== scopeIdentity(second)) {
                continue;
            }

            if (physicalInputsOverlap(first.input, second.input)) {
                diagnostics.push({ code: 'OVERLAPPING_INPUT', path: `$.mappings[${secondIndex}].input` });
            }
        }
    }

    return Object.freeze(diagnostics);
}

function snapshotActionResolution(
    resolution: ResolveControllerActionTemplateOutput
): ResolveControllerActionTemplateOutput | null {
    const record = readExactRecord(
        resolution,
        ['status', 'actionType', 'reason'],
        ['status'],
        '$',
        'UNRESOLVED_ACTION',
        'UNRESOLVED_ACTION'
    );
    if (record.status === 'invalid') {
        return null;
    }

    const status = resolution.status;
    if (status === 'resolved') {
        const hasActionType = Object.hasOwn(record.value, 'actionType');
        const hasReason = Object.hasOwn(record.value, 'reason');
        if (!hasActionType || hasReason) {
            return null;
        }

        const actionType = resolution.actionType;
        if (typeof actionType !== 'string') {
            return null;
        }

        return Object.freeze({ status, actionType });
    }

    if (status === 'unresolved') {
        const hasActionType = Object.hasOwn(record.value, 'actionType');
        const hasReason = Object.hasOwn(record.value, 'reason');
        if (hasActionType || !hasReason) {
            return null;
        }

        const reason = resolution.reason;
        if (typeof reason !== 'string') {
            return null;
        }

        return Object.freeze({ status, reason });
    }

    return null;
}

function resolveMapping(
    mapping: ParsedMappingCandidate,
    index: number,
    resolveActionTemplate: ValidateControllerMappingSchemaInput['resolveActionTemplate']
): ParseResult<ControllerMappingV1> {
    let resolution: ResolveControllerActionTemplateOutput | null;
    try {
        const resolverResult = resolveActionTemplate({ action: mapping.action, input: mapping.input });
        resolution = snapshotActionResolution(resolverResult);
    } catch {
        return failure('UNRESOLVED_ACTION', `$.mappings[${index}].action`);
    }

    if (resolution === null || resolution.status !== 'resolved') {
        return failure('UNRESOLVED_ACTION', `$.mappings[${index}].action`);
    }

    const resolvedActionType = resolution.actionType;
    if (resolvedActionType !== mapping.action.type) {
        return failure('UNRESOLVED_ACTION', `$.mappings[${index}].action`);
    }

    const action: ControllerActionTemplateV1 = Object.freeze({
        type: resolvedActionType,
        payload: mapping.action.payload,
    });

    const resolvedMapping: {
        id: string;
        input: ControllerInputV1;
        action: ControllerActionTemplateV1;
        behavior: ControllerBehaviorV1;
        curve: ControllerCurveV1;
        feedback?: ControllerFeedbackV1;
        layer?: string;
        mode?: string;
    } = {
        id: mapping.id,
        input: mapping.input,
        action,
        behavior: mapping.behavior,
        curve: mapping.curve,
    };
    if (mapping.feedback !== undefined) {
        resolvedMapping.feedback = mapping.feedback;
    }
    if (mapping.layer !== undefined) {
        resolvedMapping.layer = mapping.layer;
    }
    if (mapping.mode !== undefined) {
        resolvedMapping.mode = mapping.mode;
    }

    return success(Object.freeze(resolvedMapping));
}

export function validateControllerMappingSchema({
    value,
    resolveActionTemplate,
}: ValidateControllerMappingSchemaInput): ValidateControllerMappingSchemaOutput {
    const root = readExactRecord(value, ['schemaVersion', 'mappings'], ['schemaVersion', 'mappings'], '$');
    if (root.status === 'invalid') {
        let diagnostic: ControllerMappingSchemaDiagnostic = root.diagnostic;
        if (diagnostic.path === '$.schemaVersion') {
            diagnostic = { code: 'INVALID_SCHEMA_VERSION', path: diagnostic.path };
        }
        return Object.freeze({
            status: 'invalid',
            diagnostics: Object.freeze([diagnostic]),
        });
    }

    if (root.value.schemaVersion !== 1) {
        const diagnostic: ControllerMappingSchemaDiagnostic = {
            code: 'INVALID_SCHEMA_VERSION',
            path: '$.schemaVersion',
        };
        return Object.freeze({
            status: 'invalid',
            diagnostics: Object.freeze([diagnostic]),
        });
    }

    const mappingValues = readExactArray(root.value.mappings, '$.mappings');
    if (mappingValues.status === 'invalid') {
        return Object.freeze({ status: 'invalid', diagnostics: Object.freeze([mappingValues.diagnostic]) });
    }

    const candidates: ParsedMappingCandidate[] = [];
    const structuralDiagnostics: ControllerMappingSchemaDiagnostic[] = [];
    for (let index = 0; index < mappingValues.value.length; index += 1) {
        const candidate = parseMappingCandidate(mappingValues.value[index], index);
        if (candidate.status === 'invalid') {
            structuralDiagnostics.push(candidate.diagnostic);
            continue;
        }

        candidates.push(candidate.value);
    }

    if (structuralDiagnostics.length > 0) {
        return Object.freeze({
            status: 'invalid',
            diagnostics: Object.freeze(structuralDiagnostics),
        });
    }

    const globalDiagnostics = findGlobalDiagnostics(candidates);
    if (globalDiagnostics.length > 0) {
        return Object.freeze({ status: 'invalid', diagnostics: globalDiagnostics });
    }

    const mappings: ControllerMappingV1[] = [];
    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (candidate === undefined) {
            continue;
        }

        const mapping = resolveMapping(candidate, index, resolveActionTemplate);
        if (mapping.status === 'invalid') {
            return Object.freeze({
                status: 'invalid',
                diagnostics: Object.freeze([mapping.diagnostic]),
            });
        }

        mappings.push(mapping.value);
    }

    return Object.freeze({
        status: 'valid',
        value: Object.freeze({
            schemaVersion: 1,
            mappings: Object.freeze(mappings),
        }),
    });
}
