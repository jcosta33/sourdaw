import { realpathSync } from 'node:fs';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';

import { type Page } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { expect, test } from './e2eTest';
import { launch_new_project_via_ui, setupWorkspace } from './e2eUtils';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const ENTRY = isBuiltE2eShardRun(env) ? '/e2e/persisted-hydration.js' : '/tests/e2e/persistedHydrationEntry.ts';
test.use({ viewport: { width: 1600, height: 1000 } });

async function createObserver(page: Page) {
    return page.evaluateHandle(async (entry) => {
        const app: typeof import('./persistedHydrationEntry') = await import(entry);
        const functions = new WeakMap<object, number>();
        let nextFunction = 0;
        const encode = (value: unknown): unknown => {
            if (value === undefined) {
                return { type: 'undefined' };
            }
            if (typeof value === 'function') {
                let id = functions.get(value);
                if (id === undefined) {
                    id = ++nextFunction;
                    functions.set(value, id);
                }
                return { type: 'function', id };
            }
            if (value === null || typeof value !== 'object') {
                return value;
            }
            if (Array.isArray(value)) {
                return value.map(encode);
            }
            if (Object.getPrototypeOf(value) !== Object.prototype) {
                throw new Error('Unsupported history evidence object');
            }
            return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encode(child)]));
        };
        return {
            snapshot: () => {
                const root = app.crdt.getCrdtDoc('root');
                const history = app.command.captureUndoHistory();
                return {
                    project: app.project.projectStore.value,
                    tracks: app.arrangement.trackStore.value,
                    automation: app.automation.automationStore.value,
                    rawAutomation: root?.automation,
                    view: app.arrangement.timelineViewStore.value,
                    history: JSON.stringify(encode(history)),
                    past: history.past.length,
                    future: history.future.length,
                    lastLabel: history.past.at(-1)?.label,
                };
            },
        };
    }, ENTRY);
}

async function prepareNearbyPoints(page: Page) {
    await setupWorkspace(page);
    await launch_new_project_via_ui(page);
    const response = await page.request.get('/');
    expect(decodeURIComponent(response.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    const observer = await createObserver(page);
    await expect
        .poll(async () =>
            observer.evaluate((o) => {
                const project = o.snapshot().project;
                return project?.initialized === true && project.loading === false;
            })
        )
        .toBe(true);
    await page.getByRole('button', { name: 'MIDI Keys & synths', exact: true }).click();
    const row = page.getByRole('grid', { name: 'Track list' }).getByRole('row').filter({ hasText: 'MIDI' }).first();
    await expect(row).toBeVisible();
    const armId = await row.locator('[data-testid^="track-arm-"]').getAttribute('data-testid');
    if (!armId) {
        throw new Error('UI-created track has no identity');
    }
    const trackId = armId.slice('track-arm-'.length);
    await row.click();
    await expect.poll(async () => observer.evaluate((o) => o.snapshot().past)).toBe(1);
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByRole('button', { name: 'Add automation lane', exact: true }).click();
    const menu = page.getByRole('menu');
    const gain = menu
        .getByText('Track', { exact: true })
        .locator('xpath=following-sibling::button[@role="menuitem"][1]');
    await expect(gain).toHaveText('Gain');
    await gain.click();
    await expect.poll(async () => observer.evaluate((o) => o.snapshot().automation?.lanes.length)).toBe(1);
    const dock = page.getByTestId('toggle-bottom-dock');
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    await page.getByRole('tab', { name: 'Automation', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Automation', exact: true });
    await expect(panel.getByRole('button', { name: 'Remove Gain lane', exact: true })).toBeVisible();
    const svg = panel.getByRole('img');
    await page.getByLabel('Timeline editor surface').focus();
    // ViewCommands zooms by 4px/beat over the declared 2..80 range.
    for (let zoom = 0; zoom < 20; zoom++) {
        const previous = await observer.evaluate((o) => o.snapshot().view?.pixelsPerBeat ?? 0);
        if (previous >= 60) {
            break;
        }
        await page.keyboard.press('=');
        await expect
            .poll(async () => observer.evaluate((o) => o.snapshot().view?.pixelsPerBeat ?? 0))
            .toBeGreaterThan(previous);
    }
    const pixelsPerBeat = await observer.evaluate((o) => o.snapshot().view?.pixelsPerBeat ?? 0);
    expect(pixelsPerBeat).toBeGreaterThanOrEqual(60);
    const box = await svg.boundingBox();
    if (!box) {
        throw new Error('Automation surface has no bounds');
    }
    const x = box.x + Math.floor(box.width * 0.3);
    await page.mouse.click(x, box.y + box.height * 0.25);
    await expect.poll(async () => observer.evaluate((o) => o.snapshot().automation?.lanes[0]?.points.length)).toBe(1);
    await page.mouse.click(x + 1, box.y + box.height * 0.75);
    await expect.poll(async () => observer.evaluate((o) => o.snapshot().automation?.lanes[0]?.points.length)).toBe(2);
    const before = await observer.evaluate((o) => o.snapshot());
    const lane = before.automation?.lanes[0];
    if (!lane || !lane.points[0]?.id || !lane.points[1]?.id) {
        throw new Error('Both UI-created points require identities');
    }
    expect(lane.trackId).toBe(trackId);
    expect(before.tracks?.tracks.some((track) => track.id === trackId)).toBe(true);
    expect(before.rawAutomation).toEqual(before.automation);
    expect(lane.points[0].id).not.toBe(lane.points[1].id);
    expect(lane.points[0].value).not.toBe(lane.points[1].value);
    expect(Math.abs(lane.points[1].beat - lane.points[0].beat)).toBeGreaterThan(0);
    expect(Math.abs(lane.points[1].beat - lane.points[0].beat)).toBeLessThan(0.05);
    const nodes = svg.locator('[data-auto-point]');
    await expect(nodes).toHaveCount(2);
    const hit = await nodes.nth(0).locator('circle').first().boundingBox();
    if (!hit) {
        throw new Error('Target point has no hit surface');
    }
    return { observer, before, lane, pixelsPerBeat, hit };
}

test('dragging one nearby point preserves its neighbor through Undo and Redo', async ({ page }, testInfo) => {
    const { observer, before, lane, pixelsPerBeat, hit } = await prepareNearbyPoints(page);
    const [target, neighbor] = lane.points;
    if (!target || !neighbor) {
        throw new Error('Two captured points are required');
    }
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
    await page.mouse.down();
    await page.mouse.move(hit.x + hit.width / 2 + pixelsPerBeat * 0.5, hit.y + hit.height / 2 + 10);
    await page.mouse.up();
    await expect.poll(async () => observer.evaluate((o) => o.snapshot().past)).toBe(before.past + 1);
    // Legacy store writes reach raw CRDT on its deferred publication frame.
    await expect
        .poll(async () =>
            observer.evaluate((o) => {
                const snapshot = o.snapshot();
                return JSON.stringify(snapshot.rawAutomation) === JSON.stringify(snapshot.automation);
            })
        )
        .toBe(true);
    const moved = await observer.evaluate((o) => o.snapshot());
    const movedLane = moved.automation?.lanes.find((item) => item.id === lane.id);
    const movedTarget = movedLane?.points.find((point) => point.id === target.id);
    expect(movedTarget).toBeDefined();
    expect(movedTarget?.beat).not.toBe(target.beat);
    expect(movedTarget?.value).not.toBe(target.value);
    expect(movedLane).toEqual({
        ...lane,
        points: [neighbor, { ...target, beat: movedTarget?.beat, value: movedTarget?.value }],
    });
    expect(moved.rawAutomation).toEqual(moved.automation);
    expect(moved.lastLabel).toBe('Move automation point');
    expect(moved.tracks).toEqual(before.tracks);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
        .poll(async () =>
            observer.evaluate((o) => {
                const snapshot = o.snapshot();
                return [snapshot.automation, snapshot.rawAutomation];
            })
        )
        .toEqual([before.automation, before.automation]);
    const undone = await observer.evaluate((o) => o.snapshot());
    expect(undone.rawAutomation).toEqual(before.automation);
    expect(undone.past).toBe(before.past);
    expect(undone.future).toBe(1);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
        .poll(async () =>
            observer.evaluate((o) => {
                const snapshot = o.snapshot();
                return [snapshot.automation, snapshot.rawAutomation];
            })
        )
        .toEqual([moved.automation, moved.automation]);
    const redone = await observer.evaluate((o) => o.snapshot());
    expect(redone.rawAutomation).toEqual(moved.automation);
    expect(redone.history).toBe(moved.history);
    await testInfo.attach('automation-identity', {
        body: JSON.stringify({ before, moved, undone, redone }),
        contentType: 'application/json',
    });
});

test('Escape restores only the dragged point and records no movement history', async ({ page }, testInfo) => {
    const { observer, before, lane, pixelsPerBeat, hit } = await prepareNearbyPoints(page);
    await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
    await page.mouse.down();
    await page.mouse.move(hit.x + hit.width / 2 + pixelsPerBeat * 0.5, hit.y + hit.height / 2 + 10);
    const preview = await observer.evaluate((o) => o.snapshot());
    expect(preview.automation?.lanes[0]?.points.find((point) => point.id === lane.points[1].id)).toEqual(
        lane.points[1]
    );
    expect(preview.automation).not.toEqual(before.automation);
    expect(preview.rawAutomation).toEqual(preview.automation);
    expect(preview.history).toBe(before.history);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect
        .poll(async () =>
            observer.evaluate((o) => {
                const snapshot = o.snapshot();
                return [snapshot.automation, snapshot.rawAutomation];
            })
        )
        .toEqual([before.automation, before.automation]);
    const cancelled = await observer.evaluate((o) => o.snapshot());
    expect(cancelled.rawAutomation).toEqual(before.automation);
    expect(cancelled.history).toBe(before.history);
    expect(cancelled.tracks).toEqual(before.tracks);
    await testInfo.attach('automation-cancel', {
        body: JSON.stringify({ before, preview, cancelled }),
        contentType: 'application/json',
    });
});
