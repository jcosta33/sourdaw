import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    assertNativeSourceBinding,
    assertNativeTestResult,
    assertNativeWarmGraph,
    mutateTransportSource,
    verifyTransportMutations,
} from '../verifyNativeTransportMutations';

import type { NativeTestResult } from '../verifyNativeTransportMutations';

const source = readFileSync(
    join(import.meta.dirname, '../../crates/sourdaw-native/src/commands/engine_transport.rs'),
    'utf8'
);
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

function passing(spec: string): NativeTestResult {
    return {
        code: 0,
        signal: null,
        output: `running 1 test\ntest commands::engine_transport::tests::${spec} ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 900 filtered out\n`,
    };
}

function failing(spec: string, panic: string): NativeTestResult {
    return {
        code: 101,
        signal: null,
        output: `running 1 test\ntest commands::engine_transport::tests::${spec} ... FAILED\n---- commands::engine_transport::tests::${spec} stdout ----\nthread '${spec}' panicked at crates/sourdaw-native/src/commands/engine_transport.rs:1:1:\n${panic}\ntest result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 900 filtered out\n`,
    };
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'sourdaw-native-probe-control-'));
    roots.push(root);
    const sourcePath = join(root, 'source.rs');
    const evidencePath = join(root, 'evidence');
    writeFileSync(sourcePath, source);
    return { sourcePath, evidencePath };
}

describe('native transport source mutations', () => {
    it('changes the production equal-frame arm and preserves all owning test bytes', () => {
        const mutated = mutateTransportSource(source, 'adjacent-keep-first');
        expect(mutated).not.toBe(source);
        expect(mutated).not.toContain('=> *previous = segment,');
        expect(mutated.split('#[cfg(test)]')[1]).toBe(source.split('#[cfg(test)]')[1]);
    });

    it('disables both raw-value guards before collapse', () => {
        const mutated = mutateTransportSource(source, 'malformed-hidden-by-collapse');
        expect(mutated).not.toContain('if beats_per_minute <= 0.0 {');
        expect(mutated).not.toContain('if segment.numerator == 0 || segment.denominator == 0 {');
        expect(mutated.match(/if false \{/gu)).toHaveLength(2);
    });

    it('searches earlier kept frames without changing tests or engine constructors', () => {
        const mutated = mutateTransportSource(source, 'nonadjacent-frame-fold');
        expect(mutated).toContain('kept.iter_mut().find(');
        expect(mutated).toContain('TempoMap::new(&tempo_segments');
        expect(mutated.split('#[cfg(test)]')[1]).toBe(source.split('#[cfg(test)]')[1]);
    });

    it('refuses absent or ambiguous source anchors and unknown mutations', () => {
        expect(() => mutateTransportSource('', 'adjacent-keep-first')).toThrow();
        expect(() =>
            mutateTransportSource(source.replace('=> *previous = segment,', '=> {}'), 'adjacent-keep-first')
        ).toThrow();
        expect(() =>
            mutateTransportSource(
                source.replace('=> *previous = segment,', '=> *previous = segment, => *previous = segment,'),
                'adjacent-keep-first'
            )
        ).toThrow();
        expect(() => mutateTransportSource(source, 'arbitrary')).toThrow();
    });
});

describe('source and warm-graph admission', () => {
    const input = {
        head: 'a'.repeat(40),
        base: 'b'.repeat(40),
        integration: 'c'.repeat(40),
        checkout: 'c'.repeat(40),
        status: '',
    };
    it('binds immutable event commits to the clean integration checkout', () => {
        expect(assertNativeSourceBinding(input)).toEqual({ head: input.head, base: input.base });
    });
    it.each([
        { head: undefined },
        { base: undefined },
        { integration: undefined },
        { head: 'main' },
        { base: '--help' },
        { integration: 'HEAD' },
        { checkout: 'd'.repeat(40) },
        { status: ' M source.rs' },
    ])('refuses incomplete, redirected or dirty source %j', (change) => {
        expect(() => assertNativeSourceBinding({ ...input, ...change })).toThrow();
    });
    it('rejects a candidate whose graph differs from the warm owning graph', () => {
        expect(() => assertNativeWarmGraph('same', 'same')).not.toThrow();
        expect(() => assertNativeWarmGraph('candidate-graph', 'integration-graph')).toThrow('already-warm');
    });
});

describe('owning Rust assertion admission', () => {
    const spec = 'a_malformed_tempo_sharing_a_frame_is_still_refused';
    const panic = 'a tempo of 0 is refused';

    it('accepts exactly one original pass and the named expected assertion failure', () => {
        expect(() => assertNativeTestResult(passing(spec), spec)).not.toThrow();
        expect(() => assertNativeTestResult(failing(spec, panic), spec, panic)).not.toThrow();
    });

    it.each([
        ['still green', passing(spec)],
        ['no case', { ...passing(spec), output: 'running 0 tests\ntest result: ok. 0 passed; 0 failed;' }],
        [
            'compiler error 101',
            {
                code: 101,
                signal: null,
                output: 'error[E0308]: mismatched types\nerror: could not compile sourdaw-native',
            },
        ],
        ['linker error 101', { code: 101, signal: null, output: 'error: linking with cc failed' }],
        ['network error', { code: 101, signal: null, output: 'error: failed to get serde as a dependency' }],
        ['wrong case', failing('some_other_test', panic)],
        ['different panic', failing(spec, 'unrelated panic')],
        ['timeout', { ...failing(spec, panic), failure: 'timeout' }],
        ['truncated output', { ...failing(spec, panic), failure: 'output-limit' }],
        ['killed', { ...failing(spec, panic), signal: 'SIGKILL' }],
        ['unexecuted', { ...failing(spec, panic), code: null }],
    ] satisfies Array<[string, NativeTestResult]>)('refuses %s as mutation evidence', (_label, result) => {
        expect(() => assertNativeTestResult(result, spec, panic)).toThrow();
    });

    it('does not admit a mutated failure as an original pass', () => {
        expect(() => assertNativeTestResult(failing(spec, panic), spec)).toThrow();
    });
});

describe('source restoration and completed observable', () => {
    it('runs seven original cases, seven mutant failures and seven restored cases before completing', async () => {
        const options = fixture();
        let calls = 0;
        const proof = await verifyTransportMutations({
            ...options,
            runCase: async (spec) => {
                calls += 1;
                const current = readFileSync(options.sourcePath, 'utf8');
                if (current === source) {
                    return passing(spec);
                }
                if (current.includes('if false {')) {
                    return failing(spec, spec.includes('tempo') ? 'a tempo of 0 is refused' : 'a 0/4 meter is refused');
                }
                if (current.includes('kept.iter_mut().find(')) {
                    return failing(spec, 'a repeat is refused');
                }
                return failing(spec, spec.startsWith('every_') ? 'tempo at frame' : 'assertion `left == right` failed');
            },
        });
        expect(calls).toBe(21);
        expect(proof.cases.map((entry) => entry.phase)).toEqual([
            ...Array<string>(7).fill('baseline'),
            ...Array<string>(3).fill('adjacent-keep-first'),
            ...Array<string>(2).fill('malformed-hidden-by-collapse'),
            ...Array<string>(2).fill('nonadjacent-frame-fold'),
            ...Array<string>(7).fill('restored'),
        ]);
        expect(proof.sourceDigest).toBe(proof.restoredDigest);
        expect(readFileSync(options.sourcePath, 'utf8')).toBe(source);
        for (const entry of proof.cases) {
            expect(readFileSync(join(options.evidencePath, entry.log), 'utf8')).toContain(entry.spec);
        }
    });

    it.each(['green-mutant', 'timeout', 'child-reject', 'restored-failure', 'altered-source'])(
        'restores and refuses completion after %s',
        async (failure) => {
            const options = fixture();
            let calls = 0;
            await expect(
                verifyTransportMutations({
                    ...options,
                    runCase: async (spec) => {
                        calls += 1;
                        if (calls <= 7) {
                            return passing(spec);
                        }
                        if (failure === 'child-reject') {
                            throw new Error('child-start-failed');
                        }
                        if (failure === 'timeout') {
                            return { ...failing(spec, ''), failure: 'timeout' };
                        }
                        if (failure === 'green-mutant') {
                            return passing(spec);
                        }
                        if (calls <= 14) {
                            const current = readFileSync(options.sourcePath, 'utf8');
                            if (current.includes('if false {')) {
                                return failing(
                                    spec,
                                    spec.includes('tempo') ? 'a tempo of 0 is refused' : 'a 0/4 meter is refused'
                                );
                            }
                            if (current.includes('kept.iter_mut().find(')) {
                                return failing(spec, 'a repeat is refused');
                            }
                            return failing(
                                spec,
                                spec.startsWith('every_') ? 'tempo at frame' : 'assertion `left == right` failed'
                            );
                        }
                        if (failure === 'altered-source') {
                            writeFileSync(options.sourcePath, `${source}\n// unexpected test change\n`);
                            return passing(spec);
                        }
                        return failing(spec, 'original assertion failed');
                    },
                })
            ).rejects.toThrow();
            expect(readFileSync(options.sourcePath, 'utf8')).toBe(source);
        }
    );

    it('refuses missing owning cases before executing a child', async () => {
        const options = fixture();
        writeFileSync(
            options.sourcePath,
            source.replace('fn a_malformed_meter_sharing_a_frame_is_still_refused()', 'fn renamed_case()')
        );
        let called = false;
        await expect(
            verifyTransportMutations({
                ...options,
                runCase: async (spec) => {
                    called = true;
                    return passing(spec);
                },
            })
        ).rejects.toThrow('Missing owning case');
        expect(called).toBe(false);
    });
});
