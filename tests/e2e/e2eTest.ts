// The one place E2E files take `test` and `expect` from, so a fixture added here reaches every test.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { env } from 'node:process';

import { expect, test as base, type TestInfo } from '@playwright/test';

import {
    COVERAGE_DIRECTORY_ENV,
    executedSourceFiles,
    type CoverageRecord,
    type ExecutedSources,
} from '../../scripts/e2eCoverageRecord';

type CoverageRun = {
    /** Every page target the browser created or held while the test ran. */
    pageTargets: Set<string>;
    /** Set once the fixture page's coverage is collected. */
    measured: ({ targetId: string } & ExecutedSources) | null;
};

function specPathOf(testInfo: TestInfo): string {
    const { configFile } = testInfo.config;
    if (configFile === undefined) {
        throw new Error('E2E coverage needs a Playwright config file to resolve spec paths');
    }
    return relative(dirname(configFile), testInfo.file).split('\\').join('/');
}

// The record is complete only when the fixture page ran the app from its dev-server sources, every
// source was measured, and no other page ran.
function coverageRecordOf(testInfo: TestInfo, run: CoverageRun): CoverageRecord {
    const { measured } = run;
    const complete =
        measured !== null &&
        measured.loadedSources > 0 &&
        measured.unmeasured.length === 0 &&
        [...run.pageTargets].every((targetId) => targetId === measured.targetId);
    return {
        spec: specPathOf(testInfo),
        testId: testInfo.testId,
        title: testInfo.titlePath.slice(1).join(' › '),
        status: testInfo.status ?? 'interrupted',
        complete,
        executedFiles: complete ? measured.executedFiles : [],
    };
}

function writeCoverageRecord(directory: string, testInfo: TestInfo, record: CoverageRecord): void {
    mkdirSync(directory, { recursive: true });
    const name = createHash('sha256').update(testInfo.testId).digest('hex');
    writeFileSync(join(directory, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`);
}

function withCoverage(directory: string) {
    return base.extend<{ coverageRun: CoverageRun }>({
        coverageRun: [
            async ({ browser }, provide, testInfo) => {
                const run: CoverageRun = { pageTargets: new Set(), measured: null };
                // Written first so a test whose teardown never runs still leaves an incomplete record.
                writeCoverageRecord(directory, testInfo, coverageRecordOf(testInfo, run));
                const session = await browser.newBrowserCDPSession();
                session.on('Target.targetCreated', ({ targetInfo }) => {
                    if (targetInfo.type === 'page') {
                        run.pageTargets.add(targetInfo.targetId);
                    }
                });
                await session.send('Target.setDiscoverTargets', { discover: true });
                await provide(run);
                await session.detach();
                writeCoverageRecord(directory, testInfo, coverageRecordOf(testInfo, run));
            },
            { auto: true },
        ],
        page: async ({ page, baseURL, coverageRun }, provide) => {
            if (baseURL === undefined) {
                throw new Error('E2E coverage needs baseURL to recognise app source URLs');
            }
            const session = await page.context().newCDPSession(page);
            const { targetInfo } = await session.send('Target.getTargetInfo');
            await session.detach();
            await page.coverage.startJSCoverage({ resetOnNavigation: false, reportAnonymousScripts: false });
            await provide(page);
            if (page.isClosed()) {
                return;
            }
            const entries = await page.coverage.stopJSCoverage();
            coverageRun.measured = {
                targetId: targetInfo.targetId,
                ...executedSourceFiles(entries, new URL(baseURL).origin),
            };
        },
    });
}

const coverageDirectory = env[COVERAGE_DIRECTORY_ENV];

// Without the coverage directory, tests run on the unextended runner exactly as before.
export const test: typeof base = coverageDirectory ? withCoverage(coverageDirectory) : base;
export { expect };
