import { env } from 'node:process';

import { type Page } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { test, expect } from './e2eTest';
import { launch_new_project, setupWorkspace } from './e2eUtils';

const ENTRY = isBuiltE2eShardRun(env) ? '/e2e/persisted-hydration.js' : '/tests/e2e/persistedHydrationEntry.ts';

const ARP_DEFAULTS = {
    mode: 0,
    rate_denom: 8,
    gate: 0.8,
    swing: 0,
    octave_range: 1,
    octave_direction: 0,
    velocity_mode: 0,
    fixed_velocity: 100,
    restart_mode: 1,
    latch: 0,
};

type YeastSlot = {
    schemaVersion: number;
    racks: Record<
        string,
        { processors: Record<string, { deleted: boolean; value: { params: Record<string, number> } }> }
    >;
};

async function readState(page: Page, trackId: string, deviceId: string) {
    return page.evaluate(
        async ({ entryPath, trackId, deviceId }) => {
            const { arrangement, command, crdt, project, yeast }: typeof import('./persistedHydrationEntry') =
                await import(entryPath);
            const document = crdt.getCrdtDoc<{ tracks?: unknown; yeast?: YeastSlot }>('root');
            const projectState = project.projectStore.value;
            const track = arrangement.trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
            if (!document || !projectState?.initialized || projectState.loading || !track) {
                throw new Error('The actual MIDI project has not hydrated');
            }
            const history = command.captureUndoHistory();
            const latest = history.past.at(-1);
            return {
                rawYeast: document.yeast,
                rawTracks: document.tracks,
                rack: yeast.readYeastRack(deviceId),
                devices: track.devices,
                history,
                latestActionType: latest?.kind === 'action' ? latest.action.type : null,
            };
        },
        { entryPath: ENTRY, trackId, deviceId }
    );
}

test('a first Arpeggiator Rate gesture restores and redoes its canonical project value', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await setupWorkspace(page);
    await launch_new_project(page);
    await expect
        .poll(() =>
            page.evaluate(async (entryPath) => {
                const { project }: typeof import('./persistedHydrationEntry') = await import(entryPath);
                const state = project.projectStore.value;
                return state?.initialized === true && !state.loading;
            }, ENTRY)
        )
        .toBe(true);

    await page.getByRole('button', { name: 'MIDI Keys & synths' }).click();
    const row = page.getByRole('grid', { name: 'Track list' }).getByRole('row').filter({ hasText: 'MIDI 1' }).first();
    await expect(row).toBeVisible();
    await row.click();
    const armId = await row.locator('[data-testid^="track-arm-"]').getAttribute('data-testid');
    if (!armId?.startsWith('track-arm-')) {
        throw new Error('The new MIDI track has no observable identity');
    }
    const trackId = armId.slice('track-arm-'.length);

    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('tab', { name: 'Effects', exact: true }).click();
    await browser.getByRole('button', { name: 'MIDI FX' }).click();
    await browser.getByRole('button', { name: /^Yeast MIDI FX/ }).click();
    await expect(page.getByRole('button', { name: 'Close Yeast' })).toBeVisible();
    const deviceId = await page.evaluate(
        async ({ entryPath, trackId }) => {
            const { arrangement }: typeof import('./persistedHydrationEntry') = await import(entryPath);
            return arrangement.trackStore.value?.tracks
                .find((track) => track.id === trackId)
                ?.devices.find((device) => device.type === 'yeast')?.id;
        },
        { entryPath: ENTRY, trackId }
    );
    if (!deviceId) {
        throw new Error('The Browser did not add a Yeast device');
    }

    await page.getByRole('button', { name: '+ Arpeggiator', exact: true }).click();
    await expect.poll(async () => (await readState(page, trackId, deviceId)).rack.processors.length).toBe(1);
    const before = await readState(page, trackId, deviceId);
    const processor = before.rack.processors[0];
    if (!processor || processor.type !== 'arpeggiator') {
        throw new Error('The actual Yeast rack did not add an Arpeggiator');
    }
    const processorId = processor.id;
    const rawProcessor = before.rawYeast?.racks[deviceId]?.processors[processorId];
    expect(rawProcessor).toMatchObject({ deleted: false, value: { params: ARP_DEFAULTS } });
    expect(processor.params).toEqual(ARP_DEFAULTS);
    expect(before.devices.some((device) => device.id === deviceId && device.type === 'yeast')).toBe(true);
    expect(before.latestActionType).toBe('addYeastProcessor');

    const rate = page.getByRole('slider', { name: 'Rate', exact: true });
    await expect(rate).toHaveCount(1);
    await expect(rate).toHaveAttribute('aria-valuenow', '8');
    const bounds = await rate.boundingBox();
    if (!bounds) {
        throw new Error('The Arpeggiator Rate control has no pointer target');
    }
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 15);
    await expect(rate).not.toHaveAttribute('aria-valuenow', '8');
    const firstPreview = await rate.getAttribute('aria-valuenow');
    const firstHeld = await readState(page, trackId, deviceId);
    await page.mouse.move(x, y - 30);
    await expect(rate).not.toHaveAttribute('aria-valuenow', firstPreview ?? '8');
    const secondPreview = await rate.getAttribute('aria-valuenow');
    const secondHeld = await readState(page, trackId, deviceId);
    for (const held of [firstHeld, secondHeld]) {
        expect(held.rawYeast).toEqual(before.rawYeast);
        expect(held.rack.processors).toEqual(before.rack.processors);
        expect(held.history.past).toEqual(before.history.past);
        expect(held.history.future).toEqual(before.history.future);
    }
    const targetRate = Number(secondPreview);
    expect(Number.isFinite(targetRate) && targetRate !== 8).toBe(true);

    await page.mouse.up();
    await expect
        .poll(async () => {
            const state = await readState(page, trackId, deviceId);
            return {
                rawRate: state.rawYeast?.racks[deviceId]?.processors[processorId]?.value.params.rate_denom,
                projectedRate: state.rack.processors.find((entry) => entry.id === processorId)?.params?.rate_denom,
                past: state.history.past.length,
            };
        })
        .toEqual({ rawRate: targetRate, projectedRate: targetRate, past: before.history.past.length + 1 });
    const committed = await readState(page, trackId, deviceId);
    expect(committed.rawYeast?.racks[deviceId]?.processors[processorId]?.value.params).toEqual({
        ...ARP_DEFAULTS,
        rate_denom: targetRate,
    });
    expect(committed.latestActionType).toBe('setYeastProcessorParam');
    expect(committed.rawTracks).toEqual(before.rawTracks);
    expect(committed.devices).toEqual(before.devices);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect
        .poll(async () => {
            const state = await readState(page, trackId, deviceId);
            return {
                rawRate: state.rawYeast?.racks[deviceId]?.processors[processorId]?.value.params.rate_denom,
                projectedRate: state.rack.processors.find((entry) => entry.id === processorId)?.params?.rate_denom,
                past: state.history.past.length,
                future: state.history.future.length,
            };
        })
        .toEqual({ rawRate: 8, projectedRate: 8, past: before.history.past.length, future: 1 });
    const undone = await readState(page, trackId, deviceId);
    expect(undone.rawYeast).toEqual(before.rawYeast);
    expect(undone.rack.processors).toEqual(before.rack.processors);
    expect(undone.rawTracks).toEqual(before.rawTracks);
    expect(undone.devices).toEqual(before.devices);
    await expect(rate).toHaveAttribute('aria-valuenow', '8');

    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect
        .poll(async () => {
            const state = await readState(page, trackId, deviceId);
            return {
                rawRate: state.rawYeast?.racks[deviceId]?.processors[processorId]?.value.params.rate_denom,
                projectedRate: state.rack.processors.find((entry) => entry.id === processorId)?.params?.rate_denom,
                future: state.history.future.length,
            };
        })
        .toEqual({ rawRate: targetRate, projectedRate: targetRate, future: 0 });
    const redone = await readState(page, trackId, deviceId);
    expect(redone.rawYeast).toEqual(committed.rawYeast);
    expect(redone.rack.processors).toEqual(committed.rack.processors);
    expect(redone.rawTracks).toEqual(before.rawTracks);
    expect(redone.devices).toEqual(before.devices);
    await expect(rate).toHaveAttribute('aria-valuenow', String(targetRate));

    await test.info().attach('yeast-first-rate-undo-evidence', {
        body: Buffer.from(
            JSON.stringify(
                {
                    trackId,
                    deviceId,
                    processorId,
                    firstPreview,
                    secondPreview,
                    targetRate,
                    before,
                    firstHeld,
                    secondHeld,
                    committed,
                    undone,
                    redone,
                },
                null,
                2
            )
        ),
        contentType: 'application/json',
    });
});
