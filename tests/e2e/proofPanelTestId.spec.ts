import { test, expect } from '@playwright/test';

import { chooseProjectDirectory } from './chosenProjectDirectory';
import { launch_new_project, setupWorkspace, wait_for_launch_first_paint, wait_for_workspace_ready } from './e2eUtils';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// Proof is a mastering effect added via the inspector Add-device menu on a
// track. The previous version of this spec opened the panel via browser search
// (Proof is not in the browser) and silently skipped every assertion behind
// `if (await …isVisible())` guards, so a regression that broke the add flow
// turned the tests into no-ops. This version asserts the real add state change
// directly: the Bypass-button count rises by one and a `Bypass Proof` toggle
// appears — the same contract the rewritten Crust/Dutch Oven tests assert.
test.describe('Proof device — add to chain', () => {
    test.beforeEach(async ({ page }) => {
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    });

    test('Adding Proof creates a bypassable device card in the chain', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        const devices_before = await inspector.getByRole('button', { name: /^Bypass /i }).count();

        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();

        // A Proof device card is added — count rises by one and the bypass
        // toggle is present, where the panel-open guards used to hide a failure.
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();
        const devices_after = await inspector.getByRole('button', { name: /^Bypass /i }).count();
        expect(devices_after).toBe(devices_before + 1);
    });

    test('shared named tiers retain the earlier controls and their settings', async ({ page }) => {
        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();
        await inspector.getByText('Proof', { exact: false }).first().click();

        const selector = page.getByRole('group', { name: 'Effect control detail' });
        await expect(selector).toBeVisible();
        await expect(selector.getByRole('button', { name: 'play', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        const ceiling = page.getByRole('slider', { name: 'Mission limiter ceiling', exact: true });
        await expect(ceiling).toBeVisible();
        const before = await ceiling.getAttribute('aria-valuenow');
        if (before === null) {
            throw new Error('Proof mission ceiling has no current value');
        }

        for (const [selected, tier] of ['play', 'shape', 'build', 'route', 'lab'].entries()) {
            await selector.getByRole('button', { name: tier, exact: true }).click();
            await expect(selector.getByRole('button', { name: tier, exact: true })).toHaveAttribute(
                'aria-pressed',
                'true'
            );
            for (const [floor, name] of ['Play', 'Shape', 'Build', 'Route', 'Lab'].entries()) {
                await expect(page.getByRole('region', { name: `${name} controls`, exact: true })).toHaveCount(
                    floor <= selected ? 1 : 0
                );
            }
            await expect(ceiling).toHaveAttribute('aria-valuenow', before);
        }
        await selector.getByRole('button', { name: 'play', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Build controls', exact: true })).toHaveCount(0);
        await expect(ceiling).toHaveAttribute('aria-valuenow', before);
    });

    test('saved disclosure and ceiling survive reopening in a fresh page', async ({ page }) => {
        test.setTimeout(120_000);
        const name = 'Proof disclosure round trip';
        const projectNameControl = page.getByTestId('project-name');
        await expect(projectNameControl).toBeVisible();
        await expect(projectNameControl).toHaveText('Untitled Project');
        await expect(projectNameControl.getByTitle('Unsaved changes')).toBeVisible();
        await chooseProjectDirectory(page);
        await projectNameControl.click();
        const projectName = page.locator('input:focus');
        await projectName.fill(name);
        await projectName.press('Enter');

        const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
        await inspector.getByRole('button', { name: 'Add device' }).click();
        await page.getByRole('menuitem', { name: /^Proof$/ }).click();
        await expect(inspector.getByRole('button', { name: /^Bypass Proof$/i })).toBeVisible();
        await inspector.getByText('Proof', { exact: false }).first().click();

        const selector = page.getByRole('group', { name: 'Effect control detail' });
        await selector.getByRole('button', { name: 'lab', exact: true }).click();
        await expect(selector.getByRole('button', { name: 'lab', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
        const ceiling = page.getByRole('slider', { name: 'Mission limiter ceiling', exact: true });
        const prior = await ceiling.getAttribute('aria-valuenow');
        if (prior === null) {
            throw new Error('Proof mission ceiling has no current value');
        }
        await ceiling.press('ArrowLeft');
        await expect(ceiling).not.toHaveAttribute('aria-valuenow', prior);
        const savedCeiling = await ceiling.getAttribute('aria-valuenow');
        if (savedCeiling === null) {
            throw new Error('Proof mission ceiling has no saved value');
        }
        await page.getByRole('button', { name: 'Close Proof', exact: true }).click();
        await page.keyboard.press(`${MOD}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Save Project');
        await page.getByRole('option', { name: /^Save ProjectSave project to local storage/ }).click();
        await expect(page.getByTitle('Unsaved changes')).toHaveCount(0);

        const context = page.context();
        const origin = new URL('/', page.url()).toString();
        await page.close();
        const reopened = await context.newPage();
        try {
            // Remove the live CRDT recovery copy in this isolated browser profile,
            // so the recent-project card must read the explicitly saved snapshot.
            // A static same-origin document keeps the app from reopening the DB,
            // on both development and production servers.
            const neutralDocument = await reopened.goto(new URL('/legal/SOURDAW-NOTICE.txt', origin).toString());
            if (neutralDocument === null) {
                throw new Error('The saved-project test did not load its neutral document');
            }
            expect(neutralDocument.ok()).toBe(true);
            expect(neutralDocument.headers()['content-type']).toMatch(/^text\/plain(?:;|$)/);
            await reopened.evaluate(async () => {
                await new Promise<void>((resolve, reject) => {
                    const request = indexedDB.deleteDatabase('sourdaw-crdt-docs');
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
                    request.onblocked = () => reject(new Error('IndexedDB delete was blocked'));
                });
            });
            await reopened.goto(origin);
            await wait_for_launch_first_paint(reopened);
            await reopened.getByRole('button', { name: `Open recent project ${name}`, exact: true }).click();
            await wait_for_workspace_ready(reopened);
            await expect(reopened.getByTestId('project-name')).toHaveText(name);

            const restoredInspector = reopened.getByRole('complementary', { name: 'Inspector panel' });
            await restoredInspector.getByText('Proof', { exact: false }).first().click();
            const restoredSelector = reopened.getByRole('group', { name: 'Effect control detail' });
            await expect(restoredSelector.getByRole('button', { name: 'lab', exact: true })).toHaveAttribute(
                'aria-pressed',
                'true'
            );
            await expect(reopened.getByRole('region', { name: 'Lab controls', exact: true })).toBeVisible();
            await expect(
                reopened.getByRole('slider', { name: 'Mission limiter ceiling', exact: true })
            ).toHaveAttribute('aria-valuenow', savedCeiling);
        } finally {
            await reopened.close();
        }
    });
});
