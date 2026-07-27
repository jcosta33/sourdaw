import { constants as osConstants } from 'node:os';
import { isAbsolute } from 'node:path';
import { types as utilTypes } from 'node:util';

import type {
    ProcessStreamEvidence,
    ProcessSupervisorReason,
    TrustedProcessSupervisorInput,
} from './processSupervisor.ts';

export type CodeOwnedExecutorRegistry = {
    resolve: (normalizedTargetId: string) => unknown;
};
export type ExecutorResolution =
    | { kind: 'unimplemented' }
    | { kind: 'invalid-definition' }
    | { kind: 'ready'; invocation: TrustedProcessSupervisorInput };
export type ExecutorClassification =
    | Exclude<ProcessSupervisorReason['kind'], 'exit'>
    | 'success'
    | 'incomplete-evidence'
    | 'nonzero-exit'
    | 'invalid-supervisor-result';
export type ExecutorObservation = {
    classification: ExecutorClassification;
    streamComplete: boolean;
    exitCode?: number;
    signal?: NodeJS.Signals;
    stdoutSha256?: string;
    stdoutByteCount?: number;
    stderrSha256?: string;
    stderrByteCount?: number;
    combinedByteCount?: number;
};
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const HASH = /^[a-f0-9]{64}$/;
const definitionKeys = ['executable', 'arguments', 'cwd', 'timeoutMs', 'combinedOutputByteCap'];

export const productionExecutorRegistry: CodeOwnedExecutorRegistry = Object.freeze({
    resolve: (_normalizedTargetId: string) => undefined,
});
function dataProperty(object: object, key: string, enumerable = true): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!descriptor || descriptor.enumerable !== enumerable || !('value' in descriptor)) {
        throw new Error('value is not plain data');
    }
    return descriptor.value;
}
function plainObject(value: unknown, expectedKeys?: readonly string[]): object {
    if (
        typeof value !== 'object' ||
        value === null ||
        utilTypes.isProxy(value) ||
        Reflect.getPrototypeOf(value) !== Object.prototype
    ) {
        throw new Error('value is not a plain object');
    }
    const keys = Reflect.ownKeys(value);
    if (
        keys.some((key) => typeof key !== 'string') ||
        (expectedKeys && (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))))
    ) {
        throw new Error('object shape is invalid');
    }
    return value;
}
function copyArguments(value: unknown): readonly string[] {
    if (!Array.isArray(value) || utilTypes.isProxy(value) || Reflect.getPrototypeOf(value) !== Array.prototype) {
        throw new Error('arguments are invalid');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) {
        throw new Error('arguments are invalid');
    }
    const copied = Array.from({ length: value.length }, (_, index) => {
        const argument = dataProperty(value, String(index));
        if (typeof argument !== 'string' || argument.includes('\0')) {
            throw new Error('argument is invalid');
        }
        return argument;
    });
    return Object.freeze(copied);
}
function absolutePath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value);
}

function snapshotDefinition(value: unknown): TrustedProcessSupervisorInput {
    const definition = plainObject(value, definitionKeys);
    const executable = dataProperty(definition, 'executable');
    const cwd = dataProperty(definition, 'cwd');
    const timeoutMs = dataProperty(definition, 'timeoutMs');
    const combinedOutputByteCap = dataProperty(definition, 'combinedOutputByteCap');
    if (
        !absolutePath(executable) ||
        !absolutePath(cwd) ||
        !Number.isSafeInteger(timeoutMs) ||
        Number(timeoutMs) <= 0 ||
        Number(timeoutMs) > MAX_TIMER_DELAY_MS ||
        !Number.isSafeInteger(combinedOutputByteCap) ||
        Number(combinedOutputByteCap) <= 0
    ) {
        throw new Error('executor definition is invalid');
    }
    return Object.freeze({
        executable,
        arguments: copyArguments(dataProperty(definition, 'arguments')),
        cwd,
        timeoutMs: Number(timeoutMs),
        combinedOutputByteCap: Number(combinedOutputByteCap),
    });
}
export function resolveExecutorInvocation(
    registry: CodeOwnedExecutorRegistry,
    normalizedTargetId: string
): ExecutorResolution {
    try {
        if (utilTypes.isProxy(registry)) {
            return { kind: 'invalid-definition' };
        }
        const resolveDefinition = dataProperty(registry, 'resolve');
        if (typeof resolveDefinition !== 'function') {
            return { kind: 'invalid-definition' };
        }
        const definition = Reflect.apply(resolveDefinition as (...arguments_: unknown[]) => unknown, registry, [
            normalizedTargetId,
        ]);
        if (definition === undefined) {
            return { kind: 'unimplemented' };
        }
        return { kind: 'ready', invocation: snapshotDefinition(definition) };
    } catch {
        return { kind: 'invalid-definition' };
    }
}
function normalizeEvidence(value: unknown): ProcessStreamEvidence | null {
    if (value === null) {
        return null;
    }
    const evidence = plainObject(value, ['stdout', 'stderr', 'combinedByteCount']);
    const normalizeStream = (streamValue: unknown) => {
        const stream = plainObject(streamValue, ['byteCount', 'sha256']);
        const byteCount = dataProperty(stream, 'byteCount');
        const sha256 = dataProperty(stream, 'sha256');
        if (
            !Number.isSafeInteger(byteCount) ||
            Number(byteCount) < 0 ||
            typeof sha256 !== 'string' ||
            !HASH.test(sha256)
        ) {
            throw new Error('stream evidence is invalid');
        }
        return { byteCount: Number(byteCount), sha256 };
    };
    const stdout = normalizeStream(dataProperty(evidence, 'stdout'));
    const stderr = normalizeStream(dataProperty(evidence, 'stderr'));
    const combinedByteCount = dataProperty(evidence, 'combinedByteCount');
    if (!Number.isSafeInteger(combinedByteCount) || combinedByteCount !== stdout.byteCount + stderr.byteCount) {
        throw new Error('combined count is invalid');
    }
    return { stdout, stderr, combinedByteCount: Number(combinedByteCount) };
}
function normalizeReason(value: unknown): ProcessSupervisorReason {
    const reason = plainObject(value);
    const kind = dataProperty(reason, 'kind');
    const keys = Reflect.ownKeys(reason);
    if (kind === 'exit') {
        const code = dataProperty(reason, 'code');
        if (keys.length === 2 && Number.isSafeInteger(code) && Number(code) >= 0 && Number(code) <= 255) {
            return { kind, code: Number(code) };
        }
    } else if (kind === 'signal') {
        const signal = dataProperty(reason, 'signal');
        if (keys.length === 2 && typeof signal === 'string' && Object.hasOwn(osConstants.signals, signal)) {
            return { kind, signal: signal as NodeJS.Signals };
        }
    } else if (
        keys.length === 1 &&
        typeof kind === 'string' &&
        [
            'spawn-error',
            'timeout',
            'malformed-ipc',
            'output-cap-exceeded',
            'sentinel-failure',
            'launch-error',
            'unsupported-platform',
            'termination-unconfirmed',
        ].includes(kind)
    ) {
        return { kind } as ProcessSupervisorReason;
    }
    throw new Error('supervisor reason is invalid');
}
export function normalizeExecutorObservation(value: unknown): ExecutorObservation {
    try {
        const result = plainObject(value, ['reason', 'streamEvidence']);
        const reason = normalizeReason(dataProperty(result, 'reason'));
        const evidence = normalizeEvidence(dataProperty(result, 'streamEvidence'));
        if (
            evidence &&
            (reason.kind === 'output-cap-exceeded' ||
                reason.kind === 'termination-unconfirmed' ||
                reason.kind === 'unsupported-platform')
        ) {
            throw new Error('impossible supervisor result');
        }
        const streamFields = evidence
            ? {
                  streamComplete: true,
                  stdoutSha256: evidence.stdout.sha256,
                  stdoutByteCount: evidence.stdout.byteCount,
                  stderrSha256: evidence.stderr.sha256,
                  stderrByteCount: evidence.stderr.byteCount,
                  combinedByteCount: evidence.combinedByteCount,
              }
            : { streamComplete: false };
        if (reason.kind === 'exit') {
            if (reason.code === 0 && !evidence) {
                return { classification: 'incomplete-evidence', exitCode: 0, ...streamFields };
            }
            return {
                classification: reason.code === 0 ? 'success' : 'nonzero-exit',
                exitCode: reason.code,
                ...streamFields,
            };
        }
        if (reason.kind === 'signal') {
            return { classification: 'signal', signal: reason.signal, ...streamFields };
        }
        return { classification: reason.kind, ...streamFields };
    } catch {
        return { classification: 'invalid-supervisor-result', streamComplete: false };
    }
}
