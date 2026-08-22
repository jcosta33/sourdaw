import { describe, expect, it } from 'vitest';

import { eslintEnvironment, lintConcurrency, lintThreads, parseArgs } from '../runLint.ts';

describe('runLint arguments', () => {
    it('requires a target unless the run is full', () => {
        expect(() => parseArgs([])).toThrow(/file target required/);
        expect(parseArgs(['--full'])).toEqual({ files: [], fix: false, full: true });
        expect(parseArgs(['src/a.ts'])).toEqual({ files: ['src/a.ts'], fix: false, full: false });
    });

    it('refuses a full-tree automatic fix', () => {
        expect(() => parseArgs(['--full', '--fix'])).toThrow(/full-tree automatic lint fixes are forbidden/);
    });
});

describe('linter parallelism', () => {
    it('runs on one worker by default, which is the agent-session ceiling', () => {
        expect(lintConcurrency({})).toBe('off');
        expect(lintThreads({})).toBe('2');
    });

    it('takes the worker count from the environment where there is no such ceiling', () => {
        expect(lintConcurrency({ SOURDAW_LINT_CONCURRENCY: 'auto' })).toBe('auto');
        expect(lintConcurrency({ SOURDAW_LINT_CONCURRENCY: '4' })).toBe('4');
        expect(lintThreads({ SOURDAW_LINT_THREADS: '0' })).toBe('0');
    });
});

describe('eslint heap ceiling', () => {
    it('raises the ceiling when nothing else has set one', () => {
        expect(eslintEnvironment({}).NODE_OPTIONS).toBe('--max-old-space-size=6144');
    });

    it('defers to an ancestor that already set one', () => {
        // `pnpm guard` is that ancestor. V8 honours the last occurrence of a
        // repeated flag, so appending a larger value would silently defeat the
        // ceiling rather than raise a default.
        const guarded = { NODE_OPTIONS: '--max-old-space-size=2048' };

        expect(eslintEnvironment(guarded)).toBe(guarded);
    });

    it('keeps unrelated node options', () => {
        expect(eslintEnvironment({ NODE_OPTIONS: '--enable-source-maps' }).NODE_OPTIONS).toBe(
            '--enable-source-maps --max-old-space-size=6144'
        );
    });
});
