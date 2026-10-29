import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { PlaywrightTestConfig } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';

import { configureDiagnostic } from '../diagnostics/reloadCancellation/configure';
import {
    assertCollectedHistory,
    assertCompletedHistory,
    assertProjectSemantics,
    assertRuntimeOrder,
    assertRuntimePrefix,
    historicalCases,
    type HistoryEvent,
} from '../diagnostics/reloadCancellation/history';
import {
    ORIGINAL_HEAD,
    ORIGINAL_SPEC,
    ORIGINAL_SPEC_SHA256,
    ORIGINAL_TREE,
    WRAPPER,
} from '../diagnostics/reloadCancellation/identity';
import { reportedFile } from '../diagnostics/reloadCancellation/listReporter';
import { assertOnlyWrapperOwnsOriginalCase } from '../diagnostics/reloadCancellation/qualify';
import { assertPinnedSourceIdentity } from '../diagnostics/reloadCancellation/sourceBinding';
import { admitHostedAttempt, claimExecution } from '../diagnostics/reloadCancellation/trigger';

const scratch: string[] = [];
afterEach(() => {
    for (const path of scratch.splice(0)) {
        rmSync(path, { recursive: true, force: true });
    }
});

function expectedHistory(): ReturnType<typeof historicalCases> {
    const value: unknown = JSON.parse(
        readFileSync(resolve('scripts/diagnostics/reloadCancellation/original-history.json'), 'utf8')
    );
    return historicalCases(value);
}

function events(): HistoryEvent[] {
    return expectedHistory().flatMap((entry) => [
        { kind: 'test-begin', data: { ...entry, retry: 0 } },
        { kind: 'test-end', data: { ...entry, retry: 0, status: 'passed' } },
    ]);
}

function originalConfig(): PlaywrightTestConfig {
    return {
        workers: 1,
        retries: 0,
        fullyParallel: true,
        timeout: 90_000,
        projects: [
            {
                name: 'chromium',
                testIgnore: [`/source/${ORIGINAL_SPEC}`],
                use: { viewport: { width: 1280, height: 720 } },
            },
            {
                name: 'chromium-dev',
                testMatch: ['/source/tests/e2e/aiProviderToolAuthority.spec.ts', `/source/${ORIGINAL_SPEC}`],
                use: { baseURL: 'http://127.0.0.1:5174' },
            },
        ],
        webServer: [
            { command: 'original-preview', reuseExistingServer: false, url: 'http://127.0.0.1:5173' },
            { command: 'node scripts/e2eDevServer.ts 5174', reuseExistingServer: false, url: 'http://127.0.0.1:5174' },
        ],
    };
}

describe('reload diagnostic admission (workflow registration remains separately sequenced)', () => {
    const head = 'a'.repeat(40);
    const event = { action: 'opened', pull_request: { head: { sha: head } } };
    const env = {
        GITHUB_ACTIONS: 'true',
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_RUN_ID: '123',
    };

    it('admits only the original Linux opened event on its exact harness head', () => {
        expect(() => admitHostedAttempt(event, env, 'linux', head)).not.toThrow();
        expect(() => admitHostedAttempt(event, env, 'darwin', head)).toThrow('hosted Linux');
        expect(() => admitHostedAttempt(event, env, 'linux', 'b'.repeat(40))).toThrow('harness head');
    });

    it.each(['synchronize', 'reopened', 'labeled'])('refuses a later %s event', (action) => {
        expect(() => admitHostedAttempt({ ...event, action }, env, 'linux', head)).toThrow('original PR-opened');
    });

    it('refuses a workflow rerun and missing hosted identity', () => {
        expect(() => admitHostedAttempt(event, { ...env, GITHUB_RUN_ATTEMPT: '2' }, 'linux', head)).toThrow('no rerun');
        expect(() => admitHostedAttempt(event, { ...env, GITHUB_ACTIONS: undefined }, 'linux', head)).toThrow(
            'hosted Linux'
        );
    });

    it('binds the exact original merge, tree, clean status and maintained-case bytes', () => {
        expect(() => assertPinnedSourceIdentity(ORIGINAL_HEAD, ORIGINAL_TREE, '', ORIGINAL_SPEC_SHA256)).not.toThrow();
        expect(() => assertPinnedSourceIdentity('b'.repeat(40), ORIGINAL_TREE, '', ORIGINAL_SPEC_SHA256)).toThrow(
            'original CI merge'
        );
        expect(() => assertPinnedSourceIdentity(ORIGINAL_HEAD, 'b'.repeat(40), '', ORIGINAL_SPEC_SHA256)).toThrow(
            'c3 tree'
        );
        expect(() =>
            assertPinnedSourceIdentity(ORIGINAL_HEAD, ORIGINAL_TREE, ' M src/app/App.tsx', ORIGINAL_SPEC_SHA256)
        ).toThrow('clean');
        expect(() => assertPinnedSourceIdentity(ORIGINAL_HEAD, ORIGINAL_TREE, '', 'b'.repeat(64))).toThrow(
            'Maintained case bytes'
        );
    });

    it('refuses a second child claim without replacing the original receipt', () => {
        const directory = mkdtempSync(join(tmpdir(), 'reload-diagnostic-claim-'));
        scratch.push(directory);
        const path = join(directory, 'claim.json');
        claimExecution(path, { first: true });
        expect(() => claimExecution(path, { first: false })).toThrow();
        expect(JSON.parse(readFileSync(path, 'utf8')) as unknown).toEqual({ first: true });
    });

    it('substitutes only the original case route and preserves file-local module imports', () => {
        const original = originalConfig();
        const candidate = configureDiagnostic(original, '/source', '/evidence', false);
        expect(() =>
            assertProjectSemantics(
                original.projects,
                candidate.projects,
                `/source/${WRAPPER}`,
                `/source/${ORIGINAL_SPEC}`
            )
        ).not.toThrow();
        expect(candidate.workers).toBe(1);
        expect(candidate.retries).toBe(0);
        expect(original.projects?.[0]?.testIgnore).toEqual([`/source/${ORIGINAL_SPEC}`]);
        expect(reportedFile(`/source/${WRAPPER}`)).toBe('persistedClipEditAcceptance.spec.ts');
        expect(reportedFile('/source/tests/e2e/recording.spec.ts')).toBe('recording.spec.ts');
        expect(() =>
            assertOnlyWrapperOwnsOriginalCase(
                ['persistedClipEditAcceptance.spec.ts'],
                ['test-results/reloadCancellation/zzPersistedClip.diagnostic.spec.ts'],
                '/source'
            )
        ).not.toThrow();
        expect(() =>
            assertOnlyWrapperOwnsOriginalCase(
                ['persistedClipEditAcceptance.spec.ts'],
                ['persistedClipEditAcceptance.spec.ts'],
                '/source'
            )
        ).toThrow('single original-case wrapper');
    });

    it('refuses missing required dev entry and reused servers', () => {
        const missing = originalConfig();
        missing.projects = [{ name: 'chromium' }, { name: 'chromium-dev', testMatch: [] }];
        expect(() => configureDiagnostic(missing, '/source', '/evidence', false)).toThrow();
        const reused = originalConfig();
        reused.webServer = [
            { command: 'node scripts/e2eDevServer.ts 5174', reuseExistingServer: true },
            { command: 'preview' },
        ];
        expect(() => configureDiagnostic(reused, '/source', '/evidence', false)).toThrow('reuse');
    });

    it('observes the original91 names,85 built and five dev predecessors before case91', () => {
        const expected = expectedHistory();
        const runtime = events();
        expect(() => assertCollectedHistory(expected, expected)).not.toThrow();
        expect(() => assertRuntimePrefix(expected, runtime.slice(0, -1))).not.toThrow();
        expect(() => assertCompletedHistory(expected, runtime)).not.toThrow();
        expect(expected.slice(0, 85).every((entry) => entry.project === 'chromium')).toBe(true);
        expect(expected.slice(85).every((entry) => entry.project === 'chromium-dev')).toBe(true);
    });

    it('refuses missing, reordered and retry-dependent predecessor history', () => {
        const expected = expectedHistory();
        const missing = events().slice(0, -1);
        missing.splice(1, 1);
        expect(() => assertRuntimePrefix(expected, missing)).toThrow();
        const reordered = [...expected];
        reordered.reverse();
        expect(() => assertCollectedHistory(expected, reordered)).toThrow('order');
        const retried = events().slice(0, -1);
        const first = retried[0];
        if (!first) {
            throw new Error('Original fixture lacks its first case');
        }
        first.data.retry = 1;
        expect(() => assertRuntimePrefix(expected, retried)).toThrow('retry0');
    });

    it('retains a target failure as failed rather than laundering it as successful evidence', () => {
        const runtime = events();
        const end = runtime.at(-1);
        if (!end) {
            throw new Error('Original fixture lacks its target completion');
        }
        end.data.status = 'failed';
        expect(() => assertRuntimeOrder(expectedHistory(), runtime)).not.toThrow();
        expect(() => assertCompletedHistory(expectedHistory(), runtime)).toThrow('failed');
    });

    it('refuses an unrelated early failure and malformed or changed worker history', () => {
        const earlyFailure = events();
        earlyFailure[1]!.data.status = 'failed';
        expect(() => assertRuntimeOrder(expectedHistory(), earlyFailure)).toThrow('Original90 successful predecessors');
        const wrongWorker = events();
        wrongWorker[0]!.data.workerIndex = 1;
        expect(() => assertRuntimeOrder(expectedHistory(), wrongWorker)).toThrow('worker');
        const noTargetEnd = events().slice(0, -1);
        expect(() => assertRuntimeOrder(expectedHistory(), noTargetEnd)).toThrow();
    });

    it('rejects a premature target and changed geometry instead of treating list success as admission', () => {
        expect(() => assertRuntimePrefix(expectedHistory(), events().slice(-2, -1))).toThrow('order');
        expect(() =>
            assertProjectSemantics(
                { use: { viewport: { width: 1280 } } },
                { use: { viewport: { width: 640 } } },
                '/wrapper',
                '/original'
            )
        ).toThrow('semantics');
    });
});
