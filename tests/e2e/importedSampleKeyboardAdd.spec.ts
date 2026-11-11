import { fileURLToPath } from 'node:url';
import { env } from 'node:process';

import { type Locator, type Page, type TestInfo } from '@playwright/test';

import { isBuiltE2eShardRun } from '../../scripts/e2eServerIdentity';

import { expect, test } from './e2eTest';
import { launch_new_project_via_ui, setupWorkspace } from './e2eUtils';

const SAMPLE_FIXTURE = fileURLToPath(new URL('../../public/samples/levain/cello/pizzT_D4_v1_RR1.wav', import.meta.url));
const SAMPLE_NAME = 'pizzT_D4_v1_RR1';
const HYDRATION_ENTRY = isBuiltE2eShardRun(env)
    ? '/e2e/persisted-hydration.js'
    : '/tests/e2e/persistedHydrationEntry.ts';
type HydrationEntry = typeof import('./persistedHydrationEntry');
type Track = NonNullable<HydrationEntry['arrangement']['trackStore']['value']>['tracks'][number];
type Clip = Track['clips'][number];
type SampleState = {
    audioTrackId: string;
    raw: Clip[];
    projected: Clip[];
    undoPast: Array<{ kind: 'action'; actionType: string } | { kind: 'callback'; label: string }>;
    undoFuture: Array<{ kind: 'action'; actionType: string } | { kind: 'callback'; label: string }>;
};

async function sampleState(page: Page): Promise<SampleState> {
    return page.evaluate(
        async ({ name, entryPath }) => {
            const { arrangement, command, crdt }: typeof import('./persistedHydrationEntry') = await import(entryPath);
            const rootTracks = crdt.getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks;
            const projectedTracks = arrangement.trackStore.value?.tracks;
            const audioTrack = projectedTracks?.find((track) => track.name === 'Audio 1' && track.kind === 'audio');
            if (!rootTracks || !projectedTracks || !audioTrack) {
                throw new Error('The current audio track and project track authorities are unavailable');
            }
            const history = command.captureUndoHistory();
            const summarizeUndo = (entries: typeof history.past) =>
                entries.map((entry) =>
                    entry.kind === 'action'
                        ? { kind: 'action' as const, actionType: entry.action.type }
                        : { kind: 'callback' as const, label: entry.label }
                );
            return {
                audioTrackId: audioTrack.id,
                raw: rootTracks.tracks.flatMap((track) => track.clips.filter((clip) => clip.name === name)),
                projected: projectedTracks.flatMap((track) => track.clips.filter((clip) => clip.name === name)),
                undoPast: summarizeUndo(history.past),
                undoFuture: summarizeUndo(history.future),
            };
        },
        { name: SAMPLE_NAME, entryPath: HYDRATION_ENTRY }
    );
}

async function prepareImportedSample(page: Page): Promise<void> {
    await setupWorkspace(page);
    await launch_new_project_via_ui(page);
    await page.getByRole('button', { name: 'Audio Record or import', exact: true }).click();
    await expect(page.getByRole('grid', { name: /Track list/i }).getByText('Audio 1', { exact: true })).toBeVisible();

    const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });
    if (!(await browserPanel.isVisible())) {
        await page.getByRole('button', { name: /Toggle browser/i }).click();
        await expect(browserPanel).toBeVisible();
    }
    await browserPanel.getByRole('tab', { name: 'Library', exact: true }).click();
    await browserPanel.getByRole('tab', { name: 'Imported', exact: true }).click();

    const chooser = page.waitForEvent('filechooser');
    await browserPanel.getByRole('button', { name: 'Import', exact: true }).click();
    await (await chooser).setFiles(SAMPLE_FIXTURE);
    await expect(browserPanel.getByText(SAMPLE_NAME, { exact: true })).toBeVisible();
}

type AddFocusCapture = {
    image: Buffer;
    rect: NonNullable<Awaited<ReturnType<Locator['boundingBox']>>>;
    clip: { x: number; y: number; width: number; height: number };
    boxShadow: string;
};

async function captureAddFocusBorder(add: Locator): Promise<AddFocusCapture> {
    const box = await add.boundingBox();
    if (!box) {
        throw new Error('The Add button has no visible bounds');
    }
    const clip = {
        x: Math.ceil(box.x),
        y: Math.floor(box.y + box.height / 2 - 4),
        width: 1,
        height: 8,
    };
    const image = await add.page().screenshot({
        animations: 'disabled',
        clip,
    });
    const boxShadow = await add.evaluate((button) => getComputedStyle(button).boxShadow);
    return { image, rect: box, clip, boxShadow };
}

async function focusAddFromPreview(page: Page, testInfo: TestInfo) {
    const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });
    const preview = browserPanel.getByRole('button', { name: `Preview ${SAMPLE_NAME}`, exact: true });
    const add = browserPanel.getByRole('button', { name: `Add ${SAMPLE_NAME} to timeline`, exact: true });
    await page.mouse.move(0, 0);
    await preview.focus();
    await expect(preview).toBeFocused();
    const unfocusedAddBorder = await captureAddFocusBorder(add);
    await page.keyboard.press('Tab');
    await expect(add).toBeFocused();
    const focusedAddBorder = await captureAddFocusBorder(add);
    expect(focusedAddBorder.image.equals(unfocusedAddBorder.image)).toBe(false);
    await testInfo.attach('add-focus-border-observation', {
        body: Buffer.from(
            JSON.stringify(
                {
                    unfocused: {
                        rect: unfocusedAddBorder.rect,
                        clip: unfocusedAddBorder.clip,
                        boxShadow: unfocusedAddBorder.boxShadow,
                    },
                    focused: {
                        rect: focusedAddBorder.rect,
                        clip: focusedAddBorder.clip,
                        boxShadow: focusedAddBorder.boxShadow,
                    },
                },
                null,
                2
            )
        ),
        contentType: 'application/json',
    });
    await testInfo.attach('add-focused', {
        body: await page.screenshot({ animations: 'disabled' }),
        contentType: 'image/png',
    });
    return { browserPanel, add };
}

async function verifyPlacedClip(page: Page, before: SampleState): Promise<SampleState> {
    await expect.poll(async () => (await sampleState(page)).projected.length).toBe(1);
    const placed = await sampleState(page);
    expect(placed.raw).toHaveLength(1);
    expect(placed.projected).toHaveLength(1);
    expect(placed.raw).toEqual(placed.projected);
    expect(placed.raw[0]).toMatchObject({ name: SAMPLE_NAME, type: 'audio', trackId: before.audioTrackId });
    expect(placed.undoPast).toHaveLength(before.undoPast.length + 1);
    expect(placed.undoPast.at(-1)).toEqual({ kind: 'action', actionType: 'addClip' });
    return placed;
}

async function verifyUndo(page: Page, before: SampleState, placed: SampleState): Promise<void> {
    await page.getByTestId('transport-undo').click();
    await expect.poll(async () => (await sampleState(page)).projected.length).toBe(0);
    const undone = await sampleState(page);
    expect(undone.raw).toEqual([]);
    expect(undone.projected).toEqual([]);
    expect(undone.undoPast).toEqual(before.undoPast);
    expect(undone.undoFuture).toHaveLength(before.undoFuture.length + 1);
    expect(undone.undoFuture.at(-1)).toEqual({ kind: 'action', actionType: 'addClip' });
    expect(placed.undoFuture).toEqual(before.undoFuture);
}

for (const key of ['Enter', 'Space'] as const) {
    test(`keyboard ${key} on an imported sample adds one undoable clip without starting transport`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(120_000);
        await prepareImportedSample(page);

        const browserPanel = page.getByRole('complementary', { name: 'Browser panel' });
        const favorite = browserPanel.getByRole('button', { name: `Add ${SAMPLE_NAME} to favorites`, exact: true });
        const play = page.getByTestId('transport-play');

        await expect(play).toHaveAttribute('aria-label', 'Play');
        const before = await sampleState(page);
        expect(before.raw).toEqual([]);
        expect(before.projected).toEqual([]);

        await focusAddFromPreview(page, testInfo);
        await page.keyboard.press(key);

        const placed = await verifyPlacedClip(page, before);
        await expect(play).toHaveAttribute('aria-label', 'Play');

        // The focused Favorite remains visible after pointer movement outside the row.
        await page.mouse.move(0, 0);
        await page.keyboard.press('Tab');
        await expect(favorite).toBeFocused();
        await expect.poll(() => favorite.evaluate((button) => getComputedStyle(button).opacity)).toBe('1');
        await testInfo.attach(`favorite-focused-${key.toLowerCase()}`, {
            body: await page.screenshot({ animations: 'disabled' }),
            contentType: 'image/png',
        });

        await page.keyboard.press('Enter');
        await expect(
            browserPanel.getByRole('button', { name: `Remove ${SAMPLE_NAME} from favorites`, exact: true })
        ).toBeVisible();
        expect(await sampleState(page)).toEqual(placed);

        await verifyUndo(page, before, placed);
    });
}

test('native drag from the sample-name Add button still places one undoable clip', async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await prepareImportedSample(page);

    const { add } = await focusAddFromPreview(page, testInfo);
    const before = await sampleState(page);
    const trackRow = page
        .getByRole('grid', { name: 'Track list', exact: true })
        .locator('[role="row"][tabindex]')
        .filter({ has: page.getByTestId(`track-mute-${before.audioTrackId}`) });
    await expect(trackRow).toHaveCount(1);
    const timeline = page.getByLabel('Timeline editor surface');
    await trackRow.scrollIntoViewIfNeeded();
    const trackBox = await trackRow.boundingBox();
    const timelineBox = await timeline.boundingBox();
    if (!trackBox || !timelineBox) {
        throw new Error('The current audio track row or timeline has no visible bounds');
    }
    const overlapTop = Math.max(trackBox.y, timelineBox.y);
    const overlapBottom = Math.min(trackBox.y + trackBox.height, timelineBox.y + timelineBox.height);
    if (overlapBottom <= overlapTop) {
        throw new Error('The current audio track row does not overlap the visible timeline');
    }
    const targetY = (overlapTop + overlapBottom) / 2 - timelineBox.y;

    await add.dragTo(timeline, { targetPosition: { x: timelineBox.width / 2, y: targetY } });
    const placed = await verifyPlacedClip(page, before);
    await verifyUndo(page, before, placed);
});
