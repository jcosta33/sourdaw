import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';
import { stringify } from 'superjson';

import { enable_direct_e2e_viewport, launch_new_project } from './e2eUtils';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const PROJECT = 'Saved transport recovery';

type SavedState = { projectId: string; tracks: string[]; past: unknown[]; future: unknown[] };

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

async function savedState(page: Page): Promise<SavedState> {
    return page.evaluate(async () => {
        const projectPath = '/src/modules/Project/stores/index.ts';
        const arrangementPath = '/src/modules/Arrangement/stores/index.ts';
        const { projectStore }: typeof import('../../src/modules/Project/stores') = await import(projectPath);
        const { trackStore }: typeof import('../../src/modules/Arrangement/stores') = await import(arrangementPath);
        const projectId = projectStore.value?.projectId;
        const serialized = sessionStorage.getItem('sourdaw-undo-session');
        if (!projectId || !serialized || !trackStore.value) {
            throw new Error('Saved project, tracks, and durable history must all exist');
        }
        const mirror = JSON.parse(serialized) as { projectId: string; past: unknown[]; future: unknown[] };
        if (mirror.projectId !== projectId) {
            throw new Error('History belongs to a different project');
        }
        return {
            projectId,
            tracks: trackStore.value.tracks.map((track) => track.name),
            past: mirror.past,
            future: mirror.future,
        };
    });
}

async function seedProject(page: Page): Promise<SavedState> {
    await enable_direct_e2e_viewport(page);
    await page.addInitScript((dismissed: string) => {
        localStorage.setItem('wd:onboarding-completed', '1');
        localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
        localStorage.setItem('wd:first-load-hint-shown', '1');
    }, stringify(true));
    const response = await page.goto('/?recovery=preserved#saved-project');
    expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    await launch_new_project(page, { firstPaintTimeoutMs: 180_000 });
    await page.getByTestId('project-name').click();
    const name = page.locator('input:focus');
    await name.fill(PROJECT);
    await name.press('Enter');
    await command(page, 'Save Project');
    await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0);
    // The first real hydration binds a newly created project's history owner.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
    await expect(page.getByTestId('project-name')).toHaveText(PROJECT);
    await command(page, 'Add Audio Track');
    await command(page, 'Add MIDI Track');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await command(page, 'Save Project');
    await expect(page.locator('[title="Unsaved changes"]')).toHaveCount(0);
    const saved = await savedState(page);
    expect(saved.past.length).toBeGreaterThan(0);
    expect(saved.future.length).toBeGreaterThan(0);
    expect(saved.tracks).toContain('Audio');
    expect(saved.tracks).not.toContain('MIDI');
    return saved;
}

for (const fault of ['transient', 'persistent', 'evaluation'] as const) {
    test(`${fault} App graph failure preserves one startup document`, async ({ page }, info) => {
        test.setTimeout(180_000);
        const saved = await seedProject(page);
        let allowApp = (): void => undefined;
        const appGate = new Promise<void>((resolve) => {
            allowApp = resolve;
        });
        const appUrls: string[] = [];
        const leafUrls: string[] = [];
        let dependencyRequests = 0;
        let preloadedErrors = 0;
        let capabilities = 0;
        let observeBootstrap = (): void => undefined;
        const bootstrapObserved = new Promise<void>((resolve) => {
            observeBootstrap = resolve;
        });
        let navigations = 0;
        let observing = false;
        let injecting = true;
        const pageErrors: string[] = [];
        let observation: unknown;
        page.on('console', (message) => {
            if (message.text().includes('[capabilities] {')) {
                capabilities += 1;
                observeBootstrap();
            }
        });
        page.on('framenavigated', (frame) => {
            if (observing && frame === page.mainFrame()) {
                navigations += 1;
            }
        });
        page.on('requestfinished', (request) => {
            if (new URL(request.url()).pathname === '/src/app/DesktopStartupError.tsx') {
                preloadedErrors += 1;
            }
        });
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.route(
            (url) => url.pathname === '/src/app/App.tsx',
            async (route) => {
                appUrls.push(route.request().url());
                await appGate;
                await route.continue();
            }
        );
        await page.route(
            (url) => url.pathname === '/src/app/queryClient.ts',
            async (route) => {
                dependencyRequests += 1;
                const response = await route.fetch();
                await route.fulfill({
                    response,
                    body: `${await response.text()}\nglobalThis.__recoveryEffects = (globalThis.__recoveryEffects ?? 0) + 1;`,
                });
            }
        );
        await page.route(
            (url) => url.pathname === '/src/app/router.ts',
            async (route) => {
                leafUrls.push(route.request().url());
                if (injecting && (fault === 'persistent' || (fault === 'transient' && leafUrls.length === 1))) {
                    await route.abort('aborted');
                    return;
                }
                const response = await route.fetch();
                let body = await response.text();
                if (injecting && fault === 'evaluation') {
                    body = `globalThis.__recoveryThrows = (globalThis.__recoveryThrows ?? 0) + 1; throw new Error('controlled App evaluation failure');\n${body}`;
                }
                await route.fulfill({ response, body });
            }
        );
        try {
            const response = await page.reload({ waitUntil: 'commit' });
            expect(decodeURIComponent(response?.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
            await expect(page.getByTestId('app-shell')).toBeVisible();
            // Passive console observation: bootstrap itself emits this marker.
            await bootstrapObserved;
            const identity = await page.evaluateHandle(async () => {
                const dependenciesPath = '/src/app/registerDependencies.ts';
                const { eventBus }: typeof import('../../src/app/registerDependencies') = await import(
                    dependenciesPath
                );
                return { document, eventBus, timeOrigin: performance.timeOrigin, url: location.href };
            });
            // Bootstrap has already evaluated registerDependencies; this read
            // cannot initiate bootstrap or configure project dependencies.
            await expect.poll(() => appUrls.length).toBe(1);
            expect(capabilities).toBe(1);
            expect(preloadedErrors).toBe(1);
            expect(leafUrls).toEqual([]);
            observing = true;
            allowApp();
            if (fault === 'transient') {
                await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
                await expect(page.getByTestId('project-name')).toHaveText(PROJECT);
                await expect(
                    page.getByRole('grid', { name: 'Track list', exact: true }).getByText('Audio', { exact: true })
                ).toBeVisible();
                expect(await savedState(page)).toEqual(saved);
                await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
                await page.getByRole('button', { name: 'Redo', exact: true }).click();
                await expect(
                    page.getByRole('grid', { name: 'Track list', exact: true }).getByText('MIDI', { exact: true })
                ).toBeVisible();
                const redone = await savedState(page);
                expect(redone.future).toHaveLength(0);
                expect(redone.past).toHaveLength(saved.past.length + 1);
                await page.getByRole('button', { name: 'Undo', exact: true }).click();
                expect(await savedState(page)).toEqual(saved);
                expect(leafUrls).toHaveLength(2);
                expect(new Set(leafUrls).size).toBe(1);
            } else {
                const terminal = page.getByRole('alert', { name: 'Sourdaw could not start' });
                await expect(terminal).toBeVisible();
                await expect(
                    terminal.getByText('The application did not finish loading. Reload Sourdaw to try again.')
                ).toBeVisible();
                await expect(terminal.getByRole('button', { name: 'Reload Sourdaw' })).toBeVisible();
                expect(leafUrls).toHaveLength(fault === 'persistent' ? 2 : 1);
            }
            observation = await identity.evaluate(async (before) => {
                const path = '/src/app/registerDependencies.ts';
                const { eventBus }: typeof import('../../src/app/registerDependencies') = await import(path);
                return {
                    document: before.document === document,
                    eventBus: before.eventBus === eventBus,
                    timeOrigin: before.timeOrigin === performance.timeOrigin,
                    url: before.url === location.href,
                };
            });
            expect(observation).toEqual({ document: true, eventBus: true, timeOrigin: true, url: true });
            expect(capabilities).toBe(1);
            expect(navigations).toBe(0);
            expect(preloadedErrors).toBe(1);
            expect(appUrls).toHaveLength(1);
            expect(dependencyRequests).toBe(1);
            expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__recoveryEffects') ?? 0))).toBe(
                fault === 'persistent' ? 0 : 1
            );
            expect(await page.evaluate(() => Number(Reflect.get(globalThis, '__recoveryThrows') ?? 0))).toBe(
                fault === 'evaluation' ? 1 : 0
            );
            expect(pageErrors).toEqual([]);
            if (fault === 'persistent') {
                injecting = false;
                const url = page.url();
                await page.getByRole('button', { name: 'Reload Sourdaw' }).click();
                await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
                expect(page.url()).toBe(url);
                expect(navigations).toBe(1);
                await expect
                    .poll(() =>
                        page.evaluate(async (projectId) => {
                            const path = '/src/modules/Project/stores/index.ts';
                            const { projectStore }: typeof import('../../src/modules/Project/stores') = await import(
                                path
                            );
                            const state = projectStore.value;
                            return (
                                state?.initialized === true && state.loading === false && state.projectId === projectId
                            );
                        }, saved.projectId)
                    )
                    .toBe(true);
                expect(await savedState(page)).toEqual(saved);
            }
        } finally {
            allowApp();
            await info.attach('real-app-import-recovery', {
                body: JSON.stringify({
                    fault,
                    browser: page.context().browser()?.version(),
                    saved,
                    appUrls,
                    leafUrls,
                    dependencyRequests,
                    preloadedErrors,
                    capabilities,
                    navigations,
                    observation,
                    pageErrors,
                }),
                contentType: 'application/json',
            });
        }
    });
}
