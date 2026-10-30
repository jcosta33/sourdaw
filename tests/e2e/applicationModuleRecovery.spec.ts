import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { stringify } from 'superjson';

import { enable_direct_e2e_viewport, launch_new_project } from './e2eUtils';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const PROJECT_NAME = 'Preserved App module recovery project';
const BURST_SIZE = 80;
const BURST_PATH = '/__e2e/app-module-recovery';

async function installAppFetchBurst(page: Page) {
    // Keep a healthy edge outstanding while failed siblings notify the module map.
    // Its release follows a real request failure, without delaying the injector.
    const leaves: Route[] = [];
    const leafRequests = new Map<string, number>();
    const failures: { path: string; error: string }[] = [];
    let pendingRequests = 0;
    let pendingReleasedByFailure = false;
    let markLeavesReady = (): void => undefined;
    const leavesReady = new Promise<void>((resolve) => (markLeavesReady = resolve));
    let markPendingReady = (): void => undefined;
    const pendingReady = new Promise<void>((resolve) => (markPendingReady = resolve));
    let markFailuresObserved = (): void => undefined;
    const failuresObserved = new Promise<void>((resolve) => (markFailuresObserved = resolve));
    let releaseLeaves = (): void => undefined;
    const leavesReleased = new Promise<void>((resolve) => (releaseLeaves = resolve));
    let releasePending = (): void => undefined;
    const pendingReleased = new Promise<void>((resolve) => (releasePending = resolve));
    const onFailure = (request: Request): void => {
        const path = new URL(request.url()).pathname;
        if (!path.startsWith(`${BURST_PATH}/leaf/`)) {
            return;
        }
        failures.push({ path, error: request.failure()?.errorText ?? 'missing failure reason' });
        pendingReleasedByFailure = true;
        releasePending();
        if (failures.length === BURST_SIZE) {
            markFailuresObserved();
        }
    };
    page.on('requestfailed', onFailure);
    await page.route(
        (url) => url.pathname.startsWith(`${BURST_PATH}/`),
        async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path === `${BURST_PATH}/pending.js`) {
                pendingRequests += 1;
                markPendingReady();
                await pendingReleased;
                await route.fulfill({
                    contentType: 'text/javascript',
                    body: 'globalThis.__recoveryPendingEffects = (globalThis.__recoveryPendingEffects ?? 0) + 1;',
                });
                return;
            }
            const match = path.match(/\/(branch|leaf)\/(\d+)\.js$/);
            if (!match) {
                throw new Error(`Unknown recovery module: ${path}`);
            }
            const index = Number(match[2]);
            if (index >= BURST_SIZE) {
                throw new Error(`Recovery module index is out of range: ${path}`);
            }
            if (match[1] === 'branch') {
                await route.fulfill({
                    contentType: 'text/javascript',
                    body: `import '${BURST_PATH}/branch/${(index + 1) % BURST_SIZE}.js'; import '${BURST_PATH}/leaf/${index}.js'; globalThis.__recoveryBranchEffects = (globalThis.__recoveryBranchEffects ?? 0) + 1;`,
                });
                return;
            }
            const count = (leafRequests.get(path) ?? 0) + 1;
            leafRequests.set(path, count);
            if (count === 1) {
                leaves.push(route);
                if (leaves.length === BURST_SIZE) {
                    markLeavesReady();
                }
                await leavesReleased;
                return;
            }
            await route.fulfill({
                contentType: 'text/javascript',
                body: 'globalThis.__recoveryLeafEffects = (globalThis.__recoveryLeafEffects ?? 0) + 1;',
            });
        }
    );
    return {
        imports: `${Array.from({ length: BURST_SIZE }, (_, index) => `import '${BURST_PATH}/branch/${index}.js';`).join('\n')}\nimport '${BURST_PATH}/pending.js';`,
        async abortFirstWave(): Promise<void> {
            await Promise.all([leavesReady, pendingReady]);
            await Promise.all(leaves.map((route) => route.abort('aborted')));
            releaseLeaves();
            await failuresObserved;
        },
        snapshot: () => ({
            failures: [...failures],
            leafRequests: [...leafRequests.values()],
            pendingRequests,
            pendingReleasedByFailure,
        }),
        release(): void {
            page.off('requestfailed', onFailure);
            releaseLeaves();
            releasePending();
        },
    };
}

async function command(page: Page, label: string): Promise<void> {
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByTestId('command-palette-input');
    await expect(input).toBeVisible();
    await input.fill(label);
    await page
        .getByRole('option')
        .filter({ has: page.getByText(label, { exact: true }) })
        .click();
    await expect(input).toHaveCount(0);
}

async function seedSavedProject(page: Page): Promise<string> {
    await enable_direct_e2e_viewport(page);
    await page.addInitScript((dismissed: string) => {
        localStorage.setItem('wd:onboarding-completed', '1');
        localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
        localStorage.setItem('wd:first-load-hint-shown', '1');
    }, stringify(true));
    const response = await page.goto('/?app-module-recovery=proof#preserved');
    expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    await launch_new_project(page, { firstPaintTimeoutMs: 180_000 });
    await page.getByTestId('project-name').click();
    const name = page.locator('input:focus');
    await name.fill(PROJECT_NAME);
    await name.press('Enter');
    await expect(page.getByTestId('project-name')).toHaveText(PROJECT_NAME);
    await command(page, 'Add Audio Track');
    await command(page, 'Save Project');
    await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0);
    return page.evaluate(async () => {
        const path = '/src/modules/Project/stores/index.ts';
        const { projectStore }: typeof import('../../src/modules/Project/stores') = await import(path);
        if (!projectStore.value?.projectId) {
            throw new Error('Saved project identity is absent');
        }
        return projectStore.value.projectId;
    });
}

test('critical rendering dependency failure retains manual entry recovery in the same document', async ({
    page,
}, info) => {
    await enable_direct_e2e_viewport(page);
    let releaseCritical = (): void => undefined;
    const criticalAllowed = new Promise<void>((resolve) => (releaseCritical = resolve));
    let markCriticalRequested = (): void => undefined;
    const criticalRequested = new Promise<void>((resolve) => (markCriticalRequested = resolve));
    const requests = { entry: 0, bootstrap: 0, critical: 0, app: 0 };
    let navigations = 0;
    const pageErrors: string[] = [];
    const requestFailures: string[] = [];
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) {
            navigations += 1;
        }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
        const path = new URL(request.url()).pathname;
        if (path === '/src/app/main.tsx') {
            requests.entry += 1;
        }
        if (path === '/src/app/bootstrap.ts') {
            requests.bootstrap += 1;
        }
        if (path === '/src/app/App.tsx') {
            requests.app += 1;
        }
    });
    page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === '/src/app/registerNotificationEventBus.ts') {
            requestFailures.push(request.failure()?.errorText ?? 'missing failure reason');
        }
    });
    await page.route(
        (url) => url.pathname === '/src/app/registerNotificationEventBus.ts',
        async (route) => {
            requests.critical += 1;
            markCriticalRequested();
            await criticalAllowed;
            await route.abort('aborted');
        }
    );
    try {
        const response = await page.goto('/?critical-startup=manual#preserved', { waitUntil: 'commit' });
        expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
        await criticalRequested;
        expect(requests.critical).toBe(1);
        await expect(page.getByRole('status', { name: 'Starting Sourdaw' })).toBeVisible();
        await expect(page.getByTestId('app-shell')).toBeVisible();
        const identity = await page.evaluateHandle(() => ({
            document,
            timeOrigin: performance.timeOrigin,
            url: location.href,
        }));
        releaseCritical();

        const failure = page.getByRole('alert', { name: 'Sourdaw could not start' });
        await expect(failure).toBeVisible();
        await expect(
            failure.getByText('The application did not load. Reload Sourdaw to try starting it again.')
        ).toBeVisible();
        await expect(failure.getByRole('button', { name: 'Reload Sourdaw' })).toBeVisible();
        await expect
            .poll(() => pageErrors)
            .toEqual([expect.stringContaining('Failed to fetch dynamically imported module:')]);
        expect(pageErrors[0]).toContain('/src/app/registerNotificationEventBus.ts');
        expect(requestFailures).toEqual(['net::ERR_ABORTED']);
        expect(requests).toEqual({ entry: 1, bootstrap: 1, critical: 1, app: 0 });
        expect(navigations).toBe(1);
        const preservation = await identity.evaluate((before) => {
            const root = document.getElementById('root');
            if (root === null) {
                throw new Error('Startup root is absent');
            }
            return {
                document: before.document === document,
                timeOrigin: before.timeOrigin === performance.timeOrigin,
                url: before.url === location.href,
                entryStarted: document.documentElement.hasAttribute('data-sourdaw-entry-started'),
                // React marks its container when createRoot runs, before the first render.
                reactRootStarted: Object.getOwnPropertyNames(root).some((key) => key.startsWith('__reactContainer$')),
                retryBudget: sessionStorage.getItem('sourdaw:entry-load-retry-v1'),
            };
        });
        expect(preservation).toEqual({
            document: true,
            timeOrigin: true,
            url: true,
            entryStarted: true,
            reactRootStarted: false,
            retryBudget: null,
        });
        await info.attach('critical-rendering-failure', {
            body: JSON.stringify({
                browser: page.context().browser()?.version(),
                requests,
                navigations,
                pageErrors,
                requestFailures,
                preservation,
            }),
            contentType: 'application/json',
        });

        const timeOrigin = await page.evaluate(() => performance.timeOrigin);
        const url = page.url();
        await failure.getByRole('button', { name: 'Reload Sourdaw' }).click();
        await expect.poll(() => page.evaluate(() => performance.timeOrigin)).not.toBe(timeOrigin);
        await expect(failure).toBeVisible();
        expect(page.url()).toBe(url);
        expect(navigations).toBe(2);
        expect(requests).toEqual({ entry: 2, bootstrap: 2, critical: 2, app: 0 });
    } finally {
        releaseCritical();
    }
});

for (const fault of ['transient', 'permanent', 'evaluation']) {
    test(`${fault} App dependency failure preserves the startup document`, async ({ page }, info) => {
        test.setTimeout(180_000);
        const projectId = await seedSavedProject(page);
        const burst = fault === 'transient' ? await installAppFetchBurst(page) : undefined;
        let releaseApp = (): void => undefined;
        const appAllowed = new Promise<void>((resolve) => (releaseApp = resolve));
        let appRequests = 0;
        let entryRequests = 0;
        const appUrls: string[] = [];
        let observation: unknown;
        let leafRequests = 0;
        let dependencyRequests = 0;
        let fallbackFinishes = 0;
        let fallbackReadyBeforeAbort = false;
        let capabilityEmissions = 0;
        let navigationCount = 0;
        let observeNavigation = false;
        let faulty = true;
        const failures: string[] = [];
        const pageErrors: { name: string; message: string }[] = [];
        let markCapabilitiesReady = (): void => undefined;
        const capabilitiesReady = new Promise<void>((resolve) => (markCapabilitiesReady = resolve));
        page.on('console', (message) => {
            if (message.text().includes('[capabilities] {')) {
                capabilityEmissions += 1;
                markCapabilitiesReady();
            }
        });
        page.on('framenavigated', (frame) => {
            if (observeNavigation && frame === page.mainFrame()) {
                navigationCount += 1;
            }
        });
        page.on('requestfinished', (request) => {
            if (new URL(request.url()).pathname === '/src/app/DesktopStartupError.tsx') {
                fallbackFinishes += 1;
            }
        });
        page.on('pageerror', (error) => pageErrors.push({ name: error.name, message: error.message }));
        page.on('request', (request) => {
            if (new URL(request.url()).pathname === '/src/app/main.tsx') {
                entryRequests += 1;
            }
        });
        page.on('requestfailed', (request) => {
            if (new URL(request.url()).pathname === '/src/app/router.ts') {
                failures.push(request.failure()?.errorText ?? 'missing failure reason');
            }
        });
        await page.route(
            (url) => url.pathname === '/src/app/App.tsx',
            async (route) => {
                appRequests += 1;
                appUrls.push(route.request().url());
                await appAllowed;
                const response = await route.fetch();
                await route.fulfill({
                    response,
                    body: `${await response.text()}\nglobalThis.__recoveryAppEffects = (globalThis.__recoveryAppEffects ?? 0) + 1;`,
                });
            }
        );
        await page.route(
            (url) => url.pathname === '/src/app/queryClient.ts',
            async (route) => {
                dependencyRequests += 1;
                const response = await route.fetch();
                await route.fulfill({
                    response,
                    body: `${await response.text()}\nglobalThis.__recoveryDependencyEffects = (globalThis.__recoveryDependencyEffects ?? 0) + 1;`,
                });
            }
        );
        await page.route(
            (url) => url.pathname === '/src/app/router.ts',
            async (route) => {
                leafRequests += 1;
                if (faulty && fault === 'permanent') {
                    await route.abort('aborted');
                    return;
                }
                const response = await route.fetch();
                const body = `${burst?.imports ?? ''}\n${await response.text()}`;
                await route.fulfill({
                    response,
                    body:
                        fault === 'evaluation' && faulty
                            ? `globalThis.__recoveryThrowEffects = (globalThis.__recoveryThrowEffects ?? 0) + 1; throw new Error('controlled App evaluation failure');\n${body}`
                            : body,
                });
            }
        );
        try {
            await page.reload({ waitUntil: 'commit' });
            // App is issued after shared bootstrap imports; observe their producer before admitting the fault.
            await capabilitiesReady;
            await expect.poll(() => appRequests).toBe(1);
            await expect(page.getByTestId('app-shell')).toBeVisible();
            await expect.poll(() => capabilityEmissions).toBe(1);
            const identity = await page.evaluateHandle(async () => {
                const project = '/src/modules/Project/useCases/index.ts';
                const {
                    whenProjectIdentityTransitionDependenciesConfigured,
                }: typeof import('../../src/modules/Project/useCases') = await import(project);
                await whenProjectIdentityTransitionDependenciesConfigured();
                const dependencies = '/src/app/registerDependencies.ts';
                const { eventBus }: typeof import('../../src/app/registerDependencies') = await import(dependencies);
                return { eventBus, document, timeOrigin: performance.timeOrigin, url: location.href };
            });
            expect(capabilityEmissions).toBe(1);
            expect(leafRequests).toBe(0);
            fallbackReadyBeforeAbort = fallbackFinishes === 1;
            observeNavigation = true;
            releaseApp();
            if (fault === 'transient') {
                if (burst === undefined) {
                    throw new Error('Transient App fetch burst is absent');
                }
                await burst.abortFirstWave();
                await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
                await expect(page.getByTestId('project-name')).toHaveText(PROJECT_NAME);
                await expect(
                    page.getByRole('grid', { name: 'Track list', exact: true }).getByText('Audio', { exact: true })
                ).toBeVisible();
                expect(leafRequests).toBe(1);
                expect(failures).toEqual([]);
                const fetched = burst.snapshot();
                expect(fetched.failures).toHaveLength(BURST_SIZE);
                expect(new Set(fetched.failures.map((failure) => failure.path)).size).toBe(BURST_SIZE);
                expect(fetched.failures.every((failure) => failure.error === 'net::ERR_ABORTED')).toBe(true);
                expect(fetched.leafRequests).toEqual(Array.from({ length: BURST_SIZE }, () => 2));
                expect(fetched.pendingRequests).toBe(1);
                expect(fetched.pendingReleasedByFailure).toBe(true);
                expect(
                    await page.evaluate(() => ({
                        branches: Reflect.get(globalThis, '__recoveryBranchEffects'),
                        leaves: Reflect.get(globalThis, '__recoveryLeafEffects'),
                        pending: Reflect.get(globalThis, '__recoveryPendingEffects'),
                    }))
                ).toEqual({ branches: BURST_SIZE, leaves: BURST_SIZE, pending: 1 });
                expect(
                    await page.evaluate(async () => {
                        const path = '/src/modules/Project/stores/index.ts';
                        const { projectStore }: typeof import('../../src/modules/Project/stores') = await import(path);
                        return projectStore.value?.projectId;
                    })
                ).toBe(projectId);
            } else {
                const failure = page.getByRole('alert', { name: 'Sourdaw could not start' });
                await expect(failure).toBeVisible();
                await expect(
                    failure.getByText('The application did not finish loading. Reload Sourdaw to try again.')
                ).toBeVisible();
                await expect(failure.getByRole('button', { name: 'Reload Sourdaw' })).toBeVisible();
                expect(leafRequests).toBe(fault === 'permanent' ? 2 : 1);
            }
            const preservation = await identity.evaluate(async (before) => {
                const path = '/src/app/registerDependencies.ts';
                const { eventBus }: typeof import('../../src/app/registerDependencies') = await import(path);
                return {
                    eventBus: before.eventBus === eventBus,
                    document: before.document === document,
                    timeOrigin: before.timeOrigin === performance.timeOrigin,
                    url: before.url === location.href,
                    beforeTimeOrigin: before.timeOrigin,
                    afterTimeOrigin: performance.timeOrigin,
                };
            });
            expect(preservation).toEqual({
                eventBus: true,
                document: true,
                timeOrigin: true,
                url: true,
                beforeTimeOrigin: expect.any(Number),
                afterTimeOrigin: expect.any(Number),
            });
            expect(capabilityEmissions).toBe(1);
            expect(navigationCount).toBe(0);
            expect(fallbackReadyBeforeAbort).toBe(true);
            expect(fallbackFinishes).toBe(1);
            expect(appRequests).toBe(1);
            expect(entryRequests).toBe(1);
            expect(dependencyRequests).toBe(1);
            expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__recoveryAppEffects') ?? 0))).toBe(
                fault === 'transient' ? 1 : 0
            );
            const dependencyEffects = await page.evaluate(() =>
                Number(Reflect.get(globalThis, '__recoveryDependencyEffects') ?? 0)
            );
            const throwEffects = await page.evaluate(() =>
                Number(Reflect.get(globalThis, '__recoveryThrowEffects') ?? 0)
            );
            expect(dependencyEffects).toBe(fault === 'permanent' ? 0 : 1);
            expect(throwEffects).toBe(fault === 'evaluation' ? 1 : 0);
            observation = { preservation, dependencyEffects, throwEffects, capabilityEmissions, navigationCount };
            const expectedPageErrors =
                fault === 'transient'
                    ? []
                    : [{ name: 'AggregateError', message: 'Sourdaw App import failed after its single retry' }];
            expect(pageErrors).toEqual(expectedPageErrors);
            if (fault === 'permanent') {
                faulty = false;
                const url = page.url();
                await page.getByRole('button', { name: 'Reload Sourdaw' }).click();
                await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
                expect(page.url()).toBe(url);
                expect(navigationCount).toBe(1);
                await expect(page.getByTestId('project-name')).toHaveText(PROJECT_NAME);
            }
            expect(pageErrors).toEqual(expectedPageErrors);
        } finally {
            burst?.release();
            releaseApp();
            await info.attach('application-module-recovery', {
                body: JSON.stringify({
                    fault,
                    projectId,
                    browser: page.context().browser()?.version(),
                    appRequests,
                    entryRequests,
                    appUrls,
                    observation,
                    leafRequests,
                    dependencyRequests,
                    fallbackReadyBeforeAbort,
                    fallbackFinishes,
                    capabilityEmissions,
                    navigationCount,
                    failures,
                    pageErrors,
                    burst: burst?.snapshot(),
                }),
                contentType: 'application/json',
            });
        }
    });
}
