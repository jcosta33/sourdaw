import { realpathSync } from 'node:fs';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';

import { type Page } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { expect, test } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const ROOT = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const ENTRY = isBuiltE2eShardRun(env) ? '/e2e/persisted-hydration.js' : '/tests/e2e/persistedHydrationEntry.ts';

declare global {
    interface Window {
        crustParameterEvidence?: { deviceId: string; calls: { name: string; value: number }[] };
    }
}

async function capture(page: Page) {
    return page.evaluate(async (entry) => {
        const { arrangement, crdt, command }: typeof import('./persistedHydrationEntry') = await import(entry);
        const tracks = arrangement.trackStore.value?.tracks;
        const root = crdt.getCrdtDoc<{ tracks: { tracks: NonNullable<typeof tracks> } }>('root');
        if (!tracks || !root?.tracks) {
            throw new Error('The live project is unavailable');
        }
        function encode(value: unknown): unknown {
            if (value === undefined) {
                return { type: 'undefined' };
            }
            if (typeof value === 'number' && !Number.isFinite(value)) {
                return { type: 'number', value: String(value) };
            }
            if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
                return value;
            }
            if (Array.isArray(value)) {
                return value.map(encode);
            }
            if (value instanceof Date) {
                return { type: 'date', value: value.toISOString() };
            }
            if (value instanceof Uint8Array) {
                return { type: 'bytes', value: Array.from(value) };
            }
            if (typeof value !== 'object' || value instanceof Map || value instanceof Set) {
                throw new Error(`Unsupported evidence value: ${typeof value}`);
            }
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
        }
        const history = command.captureUndoHistory();
        if (
            history.past.some((entry) => entry.kind !== 'action') ||
            history.future.some((entry) => entry.kind !== 'action')
        ) {
            throw new Error('Callback history cannot be represented by this evidence contract');
        }
        const devices = tracks.flatMap((track) =>
            track.devices
                .filter((device) => device.type === 'crust')
                .map((device) => ({ trackId: track.id, ...device }))
        );
        return {
            raw: JSON.stringify(encode(root)),
            projected: JSON.stringify(encode(tracks)),
            // The storage adapter's toDocSafe JSON boundary omits undefined optional leaves.
            persistedProjection: JSON.stringify(encode(JSON.parse(JSON.stringify(tracks)))),
            rawTracks: JSON.stringify(encode(root.tracks.tracks)),
            revision: crdt.captureProjectRevision(),
            selectedTrackId: arrangement.trackStore.value?.selectedTrackId,
            history: JSON.stringify(encode(history)),
            past: history.past.map((entry) => JSON.stringify(encode(entry))),
            future: history.future.map((entry) => JSON.stringify(encode(entry))),
            actionTypes: history.past.map((entry) => (entry.kind === 'action' ? entry.action.type : 'callback')),
            devices,
            runtime: window.crustParameterEvidence?.calls.slice() ?? [],
        };
    }, ENTRY);
}

test('Crust numeric keyboard and pointer gestures undo without removing the effect', async ({ page }) => {
    await setupWorkspace(page);
    await launch_new_project(page);
    const response = await page.request.get('/');
    expect(decodeURIComponent(response.headers()['x-sourdaw-root'] ?? '')).toBe(ROOT);
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page
        .getByRole('option')
        .filter({ has: page.getByText('Add MIDI Track', { exact: true }) })
        .click();
    const row = page
        .getByRole('grid', { name: /Track list/i })
        .first()
        .getByRole('row')
        .filter({ has: page.getByText('MIDI 1', { exact: true }) })
        .first();
    await expect(row).toBeVisible();
    await row.click();
    const seeded = await capture(page);
    expect(seeded.selectedTrackId).toEqual(expect.any(String));
    await expect(row.getByTestId(`track-arm-${seeded.selectedTrackId}`)).toBeVisible();
    const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
    await inspector.getByRole('button', { name: 'Add device', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Crust', exact: true }).click();
    await expect(inspector.getByRole('button', { name: 'Bypass Crust', exact: true })).toBeVisible();
    await inspector
        .locator('[data-testid^="device-card-"]')
        .filter({ has: page.getByText('Crust', { exact: true }) })
        .click();
    await expect(page.getByRole('button', { name: 'Close Crust', exact: true })).toBeVisible();
    const gain = page.getByRole('slider', { name: 'Input gain', exact: true });
    await expect(gain).toHaveAttribute('aria-valuenow', '0');
    const before = await capture(page);
    expect(before.devices).toHaveLength(1);
    expect(before.actionTypes).toContain('addTrack');
    expect(before.actionTypes.at(-1)).toBe('addDevice');
    expect(JSON.parse(before.rawTracks)).toEqual(JSON.parse(before.persistedProjection));
    const device = before.devices[0];
    if (!device) {
        throw new Error('Missing UI-created Crust');
    }
    await expect
        .poll(() =>
            page.evaluate(
                async ({ entry, trackId, deviceId }) => {
                    const { audio }: typeof import('./persistedHydrationEntry') = await import(entry);
                    return (
                        audio.getTrackStrip(trackId)?.deviceNodes.find((node) => node.deviceId === deviceId)?.controller
                            ?.ready === true
                    );
                },
                { entry: ENTRY, trackId: device.trackId, deviceId: device.id }
            )
        )
        .toBe(true);
    await page.evaluate(
        async ({ entry, trackId, deviceId }) => {
            const { audio }: typeof import('./persistedHydrationEntry') = await import(entry);
            const controller = audio
                .getTrackStrip(trackId)
                ?.deviceNodes.find((node) => node.deviceId === deviceId)?.controller;
            if (!controller) {
                throw new Error('The actual Crust runtime controller is unavailable');
            }
            const original = controller.setParam;
            const calls: { name: string; value: number }[] = [];
            window.crustParameterEvidence = { deviceId, calls };
            controller.setParam = (name, value, sampleFrame) => {
                calls.push({ name, value });
                original.call(controller, name, value, sampleFrame);
            };
        },
        { entry: ENTRY, trackId: device.trackId, deviceId: device.id }
    );
    await gain.press('ArrowUp');
    await expect(gain).toHaveAttribute('aria-valuenow', '0.1');
    await expect.poll(async () => (await capture(page)).past.length).toBe(before.past.length + 1);
    const changed = await capture(page);
    expect(JSON.parse(changed.rawTracks)).toEqual(JSON.parse(changed.persistedProjection));
    expect(changed.devices[0]?.parameterValues.gain).toBe(0.1);
    expect(changed.past.slice(0, -1)).toEqual(before.past);
    expect(changed.actionTypes.at(-1)).toBe('setDeviceParameter');
    expect(changed.runtime.at(-1)).toEqual({ name: 'gain', value: 0.1 });
    await page.keyboard.press(`${MOD}+z`);
    await expect(gain).toHaveAttribute('aria-valuenow', '0');
    const undone = await capture(page);
    expect(undone.devices.map((device) => device.id)).toEqual([device.id]);
    expect(JSON.parse(undone.rawTracks)).toEqual(JSON.parse(undone.persistedProjection));
    expect(undone.past).toEqual(before.past);
    expect(undone.future).toEqual([changed.past.at(-1)]);
    expect(undone.runtime.at(-1)).toEqual({ name: 'gain', value: 0 });
    await page.getByTestId('transport-redo').click();
    await expect(gain).toHaveAttribute('aria-valuenow', '0.1');
    const redone = await capture(page);
    expect(redone.past).toEqual(changed.past);
    expect(redone.future).toEqual([]);
    expect(JSON.parse(redone.rawTracks)).toEqual(JSON.parse(redone.persistedProjection));
    await page.getByTestId('transport-undo').click();
    await expect(gain).toHaveAttribute('aria-valuenow', '0');
    const start = await capture(page);
    const box = await gain.boundingBox();
    if (!box) {
        throw new Error('Input gain has no physical bounds');
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - box.height * 0.1);
    await page.mouse.move(x, y - box.height * 0.25);
    await expect(gain).not.toHaveAttribute('aria-valuenow', '0');
    const preview = await capture(page);
    expect(preview.raw).toBe(start.raw);
    expect(preview.projected).toBe(start.projected);
    expect(preview.revision).toBe(start.revision);
    expect(preview.history).toBe(start.history);
    expect(preview.runtime.at(-1)?.name).toBe('gain');
    const lastSample = preview.runtime.at(-1)?.value;
    await page.mouse.up();
    await expect.poll(async () => (await capture(page)).past.length).toBe(start.past.length + 1);
    const committed = await capture(page);
    expect(committed.devices[0]?.parameterValues.gain).toBe(lastSample);
    expect(JSON.parse(committed.rawTracks)).toEqual(JSON.parse(committed.persistedProjection));
    expect(committed.past.slice(0, -1)).toEqual(start.past);
    await page.getByTestId('transport-undo').click();
    await expect(gain).toHaveAttribute('aria-valuenow', '0');
    const final = await capture(page);
    expect(final.devices.map((device) => device.id)).toEqual([device.id]);
    expect(JSON.parse(final.rawTracks)).toEqual(JSON.parse(final.persistedProjection));
    expect(final.past).toEqual(start.past);
    expect(final.devices[0]?.parameterValues.gain).toBe(0);
    expect(final.runtime.at(-1)).toEqual({ name: 'gain', value: 0 });
    console.log(
        'Crust gesture evidence',
        JSON.stringify({ before, changed, undone, redone, start, preview, committed, final })
    );
});
