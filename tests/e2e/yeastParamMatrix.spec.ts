import { test, expect, type Page } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

async function openYeastPanel(page: Page): Promise<void> {
    // The Browser panel is open on a fresh project; scope inside it the way
    // yeast.spec.ts does ('Browser'-named buttons resolve to both the toggle
    // and the closer).
    const browser = page.getByRole('complementary', { name: 'Browser panel' });
    await browser.getByRole('button', { name: 'Effects', exact: true }).click();
    await browser.getByRole('button', { name: 'MIDI FX' }).click();

    const yeastCard = browser.getByRole('button', { name: 'Yeast' });
    await yeastCard.waitFor({ state: 'visible' });
    await yeastCard.click();

    await expect(page.getByRole('button', { name: 'Close Yeast' })).toBeVisible();
}

async function addArpeggiator(page: Page): Promise<void> {
    await page.getByRole('button', { name: '+ Arpeggiator' }).click();
    const arpToggle = page.getByRole('button', { name: /^Arp (On|Off)$/ });
    await expect(arpToggle).toHaveText('Arp On');
    // The deck re-renders its arp controls as the processor lands; let it
    // settle before addressing them.
    await page.waitForTimeout(1000);
}

// The param matrix became assertable when the panel decks started binding
// stored processor params (#1936): before that, every knob rendered a
// hardcoded literal and no interaction could observably change the panel.
test.describe('Yeast arp param matrix — Play and Shape decks', () => {
    test.beforeEach(async ({ page }) => {
        test.setTimeout(120000);
        await setupWorkspace(page);
        await launch_new_project(page);
        // The MIDI FX browser (and Yeast with it) mounts on a MIDI track.
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
        await openYeastPanel(page);
        await addArpeggiator(page);
    });

    test('Rate knob commits through the store: keyboard step and live readout', async ({ page }) => {
        const rate = page.getByRole('slider', { name: 'Rate' });
        await expect(rate).toHaveAttribute('aria-valuenow', '8');
        await expect(page.getByText('1/8')).toBeVisible();

        await rate.focus();
        await page.keyboard.press('ArrowUp');
        await expect(rate).toHaveAttribute('aria-valuenow', '9');
        await expect(page.getByText('1/9')).toBeVisible();

        // NB: Yeast mutations (addYeastProcessor, setYeastProcessorParam)
        // bypass the action boundary entirely, so transport-undo's top entry
        // here is the addTrack action — undoing removes the whole track and
        // unmounts the panel with it. Yeast undoability is a recorded gap
        // (ledger #1635), not asserted.
    });

    test('Mode select reflects the stored param and Latch flips its pressed state', async ({ page }) => {
        const mode = page.getByRole('combobox', { name: 'Mode' });
        await expect(mode).toHaveValue('0');

        await mode.selectOption('2');
        await expect(mode).toHaveValue('2');

        const latch = page.getByRole('button', { name: 'Latch' });
        await expect(latch).toHaveAttribute('aria-pressed', 'false');
        await latch.click();
        await expect(latch).toHaveAttribute('aria-pressed', 'true');
    });

    test('Shape deck knobs bind the arpeggiator params', async ({ page }) => {
        await page.getByRole('button', { name: /Shape/ }).click();

        const gate = page.getByRole('slider', { name: 'Gate' });
        await expect(gate).toHaveAttribute('aria-valuenow', '0.8');
        await gate.focus();
        await page.keyboard.press('ArrowUp');
        const after = Number(await gate.getAttribute('aria-valuenow'));
        expect(after).toBeGreaterThan(0.8);

        const swing = page.getByRole('slider', { name: 'Swing' });
        await expect(swing).toHaveAttribute('aria-valuenow', '0');
    });
});
