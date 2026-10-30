import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import { stringify } from 'superjson';

import { enable_direct_e2e_viewport, launch_new_project } from './e2eUtils';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const PROJECT_NAME = 'Preserved App module recovery project';

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

for (const fault of ['transient', 'permanent', 'evaluation']) {
    test(`${fault} App dependency failure preserves the startup document`, async ({ page }, info) => {
        test.setTimeout(180_000);
        const projectId = await seedSavedProject(page);
        let releaseApp = (): void => undefined;
        const appAllowed = new Promise<void>((resolve) => (releaseApp = resolve));
        let appRequests = 0;
        let leafRequests = 0;
        let dependencyRequests = 0;
        let fallbackFinishes = 0;
        let fallbackReadyBeforeAbort = false;
        let capabilityEmissions = 0;
        let navigationCount = 0;
        let observeNavigation = false;
        let faulty = true;
        const failures: string[] = [];
        const pageErrors: string[] = [];
        page.on('console', (message) => {
            if (message.text().includes('[capabilities] {')) {
                capabilityEmissions += 1;
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
        page.on('pageerror', (error) => pageErrors.push(error.message));
        page.on('requestfailed', (request) => {
            if (new URL(request.url()).pathname === '/src/app/router.ts') {
                failures.push(request.failure()?.errorText ?? 'missing failure reason');
            }
        });
        await page.route('**/src/app/App.tsx', async (route) => {
            appRequests += 1;
            await appAllowed;
            await route.continue();
        });
        await page.route('**/src/app/queryClient.ts', async (route) => {
            dependencyRequests += 1;
            const response = await route.fetch();
            await route.fulfill({
                response,
                body: `${await response.text()}\nglobalThis.__recoveryDependencyEffects = (globalThis.__recoveryDependencyEffects ?? 0) + 1;`,
            });
        });
        await page.route('**/src/app/router.ts', async (route) => {
            leafRequests += 1;
            if (faulty && (fault === 'permanent' || (fault === 'transient' && leafRequests === 1))) {
                await route.abort('aborted');
                return;
            }
            const response = await route.fetch();
            const body = await response.text();
            await route.fulfill({
                response,
                body:
                    fault === 'evaluation' && faulty
                        ? `globalThis.__recoveryThrowEffects = (globalThis.__recoveryThrowEffects ?? 0) + 1; throw new Error('controlled App evaluation failure');\n${body}`
                        : body,
            });
        });
        try {
            await page.reload({ waitUntil: 'commit' });
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
                await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
                await expect(page.getByTestId('project-name')).toHaveText(PROJECT_NAME);
                await expect(
                    page.getByRole('grid', { name: 'Track list', exact: true }).getByText('Audio', { exact: true })
                ).toBeVisible();
                expect(leafRequests).toBe(2);
                expect(failures).toEqual(['net::ERR_ABORTED']);
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
            expect(
                await identity.evaluate(async (before) => {
                    const path = '/src/app/registerDependencies.ts';
                    const { eventBus }: typeof import('../../src/app/registerDependencies') = await import(path);
                    return {
                        eventBus: before.eventBus === eventBus,
                        document: before.document === document,
                        timeOrigin: before.timeOrigin === performance.timeOrigin,
                        url: before.url === location.href,
                    };
                })
            ).toEqual({ eventBus: true, document: true, timeOrigin: true, url: true });
            expect(capabilityEmissions).toBe(1);
            expect(navigationCount).toBe(0);
            expect(fallbackReadyBeforeAbort).toBe(true);
            expect(fallbackFinishes).toBe(1);
            expect(appRequests).toBe(1);
            expect(dependencyRequests).toBe(1);
            expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__recoveryDependencyEffects') ?? 0))).toBe(
                fault === 'permanent' ? 0 : 1
            );
            expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__recoveryThrowEffects') ?? 0))).toBe(
                fault === 'evaluation' ? 1 : 0
            );
            expect(pageErrors).toEqual([]);
            if (fault === 'permanent') {
                faulty = false;
                const url = page.url();
                await page.getByRole('button', { name: 'Reload Sourdaw' }).click();
                await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
                expect(page.url()).toBe(url);
                expect(navigationCount).toBe(1);
                await expect(page.getByTestId('project-name')).toHaveText(PROJECT_NAME);
            }
        } finally {
            releaseApp();
            await info.attach('application-module-recovery', {
                body: JSON.stringify({
                    fault,
                    projectId,
                    browser: page.context().browser()?.version(),
                    appRequests,
                    leafRequests,
                    dependencyRequests,
                    fallbackReadyBeforeAbort,
                    fallbackFinishes,
                    capabilityEmissions,
                    navigationCount,
                    failures,
                    pageErrors,
                }),
                contentType: 'application/json',
            });
        }
    });
}
