import { describe, expect, it } from 'vitest';

import {
    normalizeExecutorObservation,
    productionExecutorRegistry,
    resolveExecutorInvocation,
    type CodeOwnedExecutorRegistry,
} from '../evidenceExecutor';

const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const evidence = {
    stdout: { byteCount: 0, sha256: emptyHash },
    stderr: { byteCount: 0, sha256: emptyHash },
    combinedByteCount: 0,
};
const definition = () => ({
    executable: '/trusted/executor',
    arguments: ['safe'],
    cwd: '/trusted/cwd',
    timeoutMs: 100,
    combinedOutputByteCap: 1_000,
});
const registry = (value: unknown): CodeOwnedExecutorRegistry => ({ resolve: () => value });
describe('evidence executor boundary', () => {
    it('should keep production empty and snapshot a definition by normalized target ID', () => {
        expect(resolveExecutorInvocation(productionExecutorRegistry, 'AC-060')).toEqual({ kind: 'unimplemented' });
        const mutable = definition();
        const seen: string[] = [];
        const targetRegistry = { resolve: (targetId: string) => (seen.push(targetId), mutable) };
        const resolution = resolveExecutorInvocation(targetRegistry, 'AC-060');
        mutable.executable = '/mutated';
        mutable.arguments[0] = 'mutated';
        expect([seen, resolution]).toEqual([
            ['AC-060'],
            {
                kind: 'ready',
                invocation: {
                    executable: '/trusted/executor',
                    arguments: ['safe'],
                    cwd: '/trusted/cwd',
                    timeoutMs: 100,
                    combinedOutputByteCap: 1_000,
                },
            },
        ]);
    });
    it('should reject malformed definitions without invoking accessors or proxy traps', () => {
        let accessorCalls = 0;
        let proxyTraps = 0;
        const accessor = Object.defineProperty(definition(), 'executable', {
            enumerable: true,
            get: () => {
                accessorCalls += 1;
                return '/private';
            },
        });
        const proxied = new Proxy(definition(), {
            get: (target, key) => {
                proxyTraps += 1;
                return target[key as keyof typeof target];
            },
        });
        const malformed = [
            { ...definition(), executable: 'relative' },
            { ...definition(), cwd: '/bad\0cwd' },
            { ...definition(), cwd: 'relative' },
            { ...definition(), arguments: ['bad\0argument'] },
            { ...definition(), timeoutMs: 0 },
            { ...definition(), timeoutMs: 2_147_483_648 },
            { ...definition(), combinedOutputByteCap: 0 },
            { ...definition(), combinedOutputByteCap: 1.5 },
            { ...definition(), extra: 'private' },
            accessor,
            proxied,
            { ...definition(), arguments: new Proxy(['safe'], {}) },
        ];
        const kinds = malformed.map((value) => resolveExecutorInvocation(registry(value), 'AC-060').kind);
        expect(kinds.every((kind) => kind === 'invalid-definition')).toBe(true);
        expect([accessorCalls, proxyTraps]).toEqual([0, 0]);
    });
    it.each([
        [{ kind: 'exit', code: 0 }, evidence, 'success', true],
        [{ kind: 'exit', code: 0 }, null, 'incomplete-evidence', false],
        [{ kind: 'exit', code: 7 }, evidence, 'nonzero-exit', true],
        [{ kind: 'signal', signal: 'SIGTERM' }, evidence, 'signal', true],
        [{ kind: 'timeout' }, evidence, 'timeout', true],
        [{ kind: 'output-cap-exceeded' }, null, 'output-cap-exceeded', false],
        [{ kind: 'sentinel-failure' }, evidence, 'sentinel-failure', true],
        [{ kind: 'spawn-error' }, evidence, 'spawn-error', true],
        [{ kind: 'launch-error' }, evidence, 'launch-error', true],
        [{ kind: 'malformed-ipc' }, evidence, 'malformed-ipc', true],
        [{ kind: 'unsupported-platform' }, null, 'unsupported-platform', false],
        [{ kind: 'termination-unconfirmed' }, null, 'termination-unconfirmed', false],
    ])('should normalize supervisor terminal matrix %#', (reason, streamEvidence, classification, streamComplete) => {
        expect(normalizeExecutorObservation({ reason, streamEvidence })).toMatchObject({
            classification,
            streamComplete,
        });
    });
    it('should fail closed on impossible or secret-bearing supervisor results', () => {
        const impossible = ['output-cap-exceeded', 'unsupported-platform', 'termination-unconfirmed'].map((kind) =>
            normalizeExecutorObservation({ reason: { kind }, streamEvidence: evidence })
        );
        const malformed = normalizeExecutorObservation({
            reason: { kind: 'private-terminal', raw: 'private-token' },
            streamEvidence: null,
        });
        expect(
            [...impossible, malformed].every(({ classification }) => classification === 'invalid-supervisor-result')
        ).toBe(true);
        expect(JSON.stringify([...impossible, malformed])).not.toContain('private-token');
    });
});
