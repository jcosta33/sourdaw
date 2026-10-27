import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const POSITION = /^\d+\.\d+\.\d{3}$/;

async function readPlayhead(page: Page): Promise<string> {
    const text = (await page.getByTestId('transport-playhead').textContent())?.replaceAll(/\s/g, '') ?? '';
    return text.match(/\d+\.\d+\.\d{3}$/)?.[0] ?? text;
}

async function waitForMovingPlayhead(page: Page): Promise<void> {
    const samples = new Set<string>();
    await expect
        .poll(
            async () => {
                const position = await readPlayhead(page);
                if (POSITION.test(position) && position !== '1.1.000') {
                    samples.add(position);
                }
                return samples.size;
            },
            { timeout: 15_000 }
        )
        .toBeGreaterThanOrEqual(2);
}

test('native button Enter and Space activate once without transport shortcuts; workspace and modified shortcuts remain', async ({
    page,
}) => {
    test.setTimeout(120_000);
    await setupWorkspace(page);
    await launch_new_project(page);
    await page.locator('#main-content').click();
    await page.keyboard.press('n');
    await expect(
        page
            .getByRole('grid', { name: /Track list/i })
            .first()
            .getByText('MIDI', { exact: true })
    ).toBeVisible();

    const play = page.getByTestId('transport-play');
    const toggle = page.getByRole('button', { name: 'Toggle browser' });
    const panel = page.getByRole('complementary', { name: 'Browser panel' });
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await play.click();
    await waitForMovingPlayhead(page);
    await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Play');
    const pausedPosition = await readPlayhead(page);
    expect(pausedPosition).toMatch(POSITION);
    expect(pausedPosition).not.toBe('1.1.000');

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(panel).toBeHidden();
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await expect.poll(() => readPlayhead(page)).toBe(pausedPosition);

    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toBeVisible();
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await expect.poll(() => readPlayhead(page)).toBe(pausedPosition);

    await page.keyboard.press(`${MOD}+b`);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(panel).toBeHidden();
    await expect.poll(() => readPlayhead(page)).toBe(pausedPosition);

    await page.locator('#main-content').click();
    await page.keyboard.press('Space');
    await expect(play).toHaveAttribute('aria-label', 'Pause');
    await waitForMovingPlayhead(page);
    await page.keyboard.press('Enter');
    await expect(play).toHaveAttribute('aria-label', 'Play');
    await expect.poll(() => readPlayhead(page)).toBe('1.1.000');
});
