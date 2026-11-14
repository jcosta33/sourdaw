import { afterEach, describe, expect, it, vi } from 'vitest';

const child = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: child }));

import {
    EXPECTED_REJECTIONS,
    EXPECTED_RUST_CASES,
    requireFixturePlatform,
    requireRustCases,
    requireRustRejections,
    runRustConsumerFixtures,
    wasiExecutables,
    WASI_CASES,
    type FixturePlatform,
} from '../runRustConsumerFixtures';

function passed(names: readonly string[], filtered = 0): string {
    return `${names.map((name) => `test ${name} ... ok`).join('\n')}\ntest result: ok. ${names.length} passed; 0 failed; 0 ignored; 0 measured; ${filtered} filtered out; finished in 0.01s\n`;
}

function artifact(name: string, executable: string): string {
    return JSON.stringify({ reason: 'compiler-artifact', target: { name }, profile: { test: true }, executable });
}

afterEach(() => {
    child.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('actual bounded Rust test admission', () => {
    it('requires every Windows case with no zero, ignored or filtered admission', () => {
        const names = EXPECTED_RUST_CASES.windows;
        expect(names).toHaveLength(8);
        expect(() => requireRustCases(passed(names), names)).not.toThrow();
        for (const output of [
            'test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out;',
            passed(names).replace('0 ignored', '1 ignored'),
            passed(names).replace('0 filtered out', '1 filtered out'),
            passed(names).replace('0 failed', '1 failed'),
            passed(names).replace('0 measured', '1 measured'),
        ])
            expect(() => requireRustCases(output, names)).toThrow();
    });

    it('refuses missing, duplicate, renamed and failed cases beside a passing count', () => {
        const output = passed(['borrowed', 'outref']);
        for (const changed of [
            output.replace('test outref ... ok\n', ''),
            output.replace('test outref', 'test borrowed'),
            output.replace('test outref', 'test another'),
            output.replace('test outref ... ok', 'test outref ... FAILED'),
            output.replace(/^test result:.*$/mu, ''),
        ])
            expect(() => requireRustCases(changed, ['borrowed', 'outref'])).toThrow();
    });

    it('does not admit an empty expectation or a zero-subject extra target', () => {
        expect(() => requireRustCases(passed([]), [])).toThrow('nonempty');
        const output = `${passed(['borrowed'])}test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;`;
        expect(() => requireRustCases(output, ['borrowed'])).toThrow('zero');
    });

    it('observes a real libtest nocapture layout without accepting the wrong exact filter', () => {
        const output =
            'test maximum ... actual usize bytes=4 bits=32\ncandidate after load\nok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out;\nWASI.start exit=0\n';
        expect(() => requireRustCases(output, ['maximum'], true)).not.toThrow();
        expect(() => requireRustCases(output, ['another'], true)).toThrow('actually pass');
        expect(() => requireRustCases(output.replace('\nok\n', '\nFAILED\n'), ['maximum'], true)).toThrow('report ok');
    });

    it('allows deliberate private-library filtering only when all named subjects executed', () => {
        const names = EXPECTED_RUST_CASES.private;
        expect(() => requireRustCases(passed(names, 188), names, true)).not.toThrow();
        expect(() => requireRustCases(passed(names, 188), names)).toThrow('filtered');
        expect(() => requireRustCases(passed(names.slice(1), 189), names, true)).toThrow('actually pass');
    });

    it('rejects a claimed platform that differs from the real host and unknown platforms', () => {
        expect(() => requireFixturePlatform('windows', 'linux')).toThrow('actual native platform');
        expect(() => requireFixturePlatform('other', 'linux')).toThrow('actual native platform');
    });

    it('requires each actual intended compiler rejection beside the total', () => {
        const output = `${EXPECTED_REJECTIONS.map((name) => `expected-rejection: ${name}`).join('\n')}\nexpected-rejections: 6 of 6\n`;
        expect(() => requireRustRejections(output)).not.toThrow();
        expect(() => requireRustRejections('expected-rejections: 6 of 6\n')).toThrow('Every selected');
        expect(() => requireRustRejections(output.replace('num_enum_invalid_repr', 'another'))).toThrow(
            'Every selected'
        );
    });

    it('overrides inherited root-only offline admission for every standalone fixture child', () => {
        vi.stubEnv('CARGO_NET_OFFLINE', 'true');
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        vi.spyOn(console, 'log').mockImplementation(() => {});
        child.mockImplementation((program: string, args: readonly string[]) => {
            let output: string;
            if (program === 'python' || program === 'python3')
                output = `${EXPECTED_REJECTIONS.map((name) => `expected-rejection: ${name}`).join('\n')}\nexpected-rejections: 6 of 6\n`;
            else if (args.includes('windows_projection_abi')) output = passed(EXPECTED_RUST_CASES.windows);
            else if (args.includes('vendor/rust/fixtures/bindgen-abi/Cargo.toml'))
                output = passed(EXPECTED_RUST_CASES.headers);
            else if (args.includes('vendor/rust/fixtures/loader-lifecycle/Cargo.toml'))
                output = passed(EXPECTED_RUST_CASES.loader);
            else if (args.includes('vendor/rust/fixtures/automerge-stable/Cargo.toml'))
                output = passed(EXPECTED_RUST_CASES.public);
            else if (args.includes('dev_consumer')) output = passed(EXPECTED_RUST_CASES.dev);
            else if (args.includes('root_port_') && !args.includes('--skip'))
                output = passed(EXPECTED_RUST_CASES.private, 188);
            else if (args.includes('--skip')) output = passed(EXPECTED_RUST_CASES.paired, 191);
            else output = passed(EXPECTED_RUST_CASES.macros);
            return { status: 0, stdout: output, stderr: '', signal: null };
        });
        let platform: FixturePlatform;
        if (process.platform === 'darwin') platform = 'macos';
        else if (process.platform === 'win32') platform = 'windows';
        else if (process.platform === 'linux') platform = 'linux';
        else throw new Error('Unsupported fixture test host');
        runRustConsumerFixtures(platform, false);
        expect(child).toHaveBeenCalled();
        for (const [, , options] of child.mock.calls) {
            expect(options.env).toMatchObject({
                CARGO_NET_OFFLINE: 'false',
                CARGO_BUILD_JOBS: '2',
                RUST_TEST_THREADS: '2',
            });
        }
        const macros = child.mock.calls.find(([, args]) => args.includes('cexpr_nom8'));
        expect(macros?.[1]).toContain('--locked');
        expect(macros?.[1]).not.toContain('--tests');
        const loader = child.mock.calls.some(([, args]) =>
            args.includes('vendor/rust/fixtures/loader-lifecycle/Cargo.toml')
        );
        expect(loader).toBe(platform !== 'windows');
    });
});

describe('actual WASI compiler-artifact admission', () => {
    it('selects emitted test executables and keeps all five exact filters', () => {
        const output = `${artifact('host32', '/target/host32.wasm')}\n${artifact('stable_consumer', '/target/stable.wasm')}\n`;
        expect(wasiExecutables(output, ['host32', 'stable_consumer'])).toEqual(
            new Map([
                ['host32', '/target/host32.wasm'],
                ['stable_consumer', '/target/stable.wasm'],
            ])
        );
        expect(WASI_CASES).toHaveLength(5);
        expect(new Set(WASI_CASES.map(({ name }) => name)).size).toBe(5);
    });

    it('rejects missing, duplicate, relative and native compiler executables', () => {
        for (const output of [
            '',
            `${artifact('host32', '/target/a.wasm')}\n${artifact('host32', '/target/b.wasm')}`,
            artifact('host32', 'relative/host.wasm'),
            artifact('host32', '/target/host.exe'),
            JSON.stringify({
                reason: 'compiler-artifact',
                target: { name: 'host32' },
                profile: { test: false },
                executable: '/target/host.wasm',
            }),
        ])
            expect(() => wasiExecutables(output, ['host32'])).toThrow();
    });
});
