import { expect, test, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

function buildWavBytes(): Buffer {
    const sampleRate = 44100;
    const samples = sampleRate;
    const dataSize = samples * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples; i += 1) {
        buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 6000), 44 + i * 2);
    }
    return buffer;
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) === 'false') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function openElasticEditor(page: Page): Promise<void> {
    await page.keyboard.press(`${MOD}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add Audio Track');
    await page.getByRole('option', { name: 'Add Audio Track' }).click();

    const trackList = page.getByRole('grid', { name: /Track list/i }).first();
    await trackList.getByRole('row').first().waitFor({ state: 'visible' });
    await trackList.getByRole('row').first().click({ button: 'right' });
    await page.getByRole('menu').waitFor({ state: 'visible' });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: /Import Audio/i }).click();
    await (
        await chooser
    ).setFiles({
        name: 'probe.wav',
        mimeType: 'audio/wav',
        buffer: buildWavBytes(),
    });

    await openBottomTab(page, 'Editor');
    await expect(page.getByTestId('selected-track-clip-count')).toHaveText(/1 clip/i, { timeout: 15_000 });
    await page.getByRole('complementary', { name: 'Inspector panel' }).getByText('probe', { exact: true }).click();
    await openBottomTab(page, 'Elastic');
}

function elasticPanel(page: Page) {
    return page.getByTestId('elastic-editor-panel');
}

test.describe('Elastic audio editor', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        await openElasticEditor(page);
    });

    test('elastic editor panel opens with Select pressed', async ({ page }) => {
        const panel = elasticPanel(page);
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
        await expect(panel.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'false');
    });

    test('switching elastic tools changes aria-pressed', async ({ page }) => {
        const panel = elasticPanel(page);
        await expect(panel.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true');
        await panel.getByRole('button', { name: 'Add' }).click();
        await expect(panel.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'true');
        await expect(panel.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'false');
        await panel.getByRole('button', { name: 'Remove' }).click();
        await expect(panel.getByRole('button', { name: 'Remove' })).toHaveAttribute('aria-pressed', 'true');
        await expect(panel.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-pressed', 'false');
    });
});
