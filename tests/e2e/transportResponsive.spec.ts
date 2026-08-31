import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const effectiveWidths = [1440, 1200, 1024, 819, 683, 640, 512, 410, 341, 320, 256];
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const longProjectName = 'A maximum length dirty project name that must never cover the command prompt';

test.describe('Responsive transport bar', () => {
    test('keeps topbar controls visible and non-overlapping at every supported effective width', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.keyboard.press(`${modifier}+k`);
        await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
        await page.getByRole('option', { name: 'Add MIDI Track' }).click();
        await page
            .getByRole('grid', { name: /Track list/i })
            .getByRole('button', { name: /^Arm / })
            .first()
            .click();
        await page.getByTestId('project-name').click();
        await page.locator('input.daw-readout-well').fill(longProjectName);
        await page.locator('input.daw-readout-well').press('Enter');
        await expect(page.getByTitle('Unsaved changes')).toBeVisible();

        for (const width of effectiveWidths) {
            await page.setViewportSize({ width, height: 900 });
            await expect(page.getByTestId('transport-play')).toBeVisible();
            await expect(page.getByTestId('transport-stop')).toBeVisible();
            await expect(page.getByTestId('transport-record')).toBeVisible();
            await expect(page.getByTestId('transport-loop')).toBeVisible();

            const geometry = await page.evaluate(() => {
                const header = document.querySelector('header[aria-label="Transport controls"]');
                if (header === null) {
                    throw new Error('Transport header was not found');
                }
                const headerBounds = header.getBoundingClientRect();
                const controls = Array.from(header.querySelectorAll<HTMLElement>('button, input, [role="radio"]'))
                    .map((control) => {
                        const bounds = control.getBoundingClientRect();
                        return {
                            name: control.getAttribute('aria-label') ?? control.dataset.testid ?? 'unnamed',
                            left: bounds.left,
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            width: bounds.width,
                            height: bounds.height,
                        };
                    })
                    .filter((control) => control.width > 0 && control.height > 0);
                const intersections = controls.flatMap((control, index) =>
                    controls
                        .slice(index + 1)
                        .flatMap((candidate) =>
                            control.left < candidate.right &&
                            control.right > candidate.left &&
                            control.top < candidate.bottom &&
                            control.bottom > candidate.top
                                ? [`${control.name} / ${candidate.name}`]
                                : []
                        )
                );
                const escaped = controls
                    .filter((control) => control.left < headerBounds.left || control.right > headerBounds.right)
                    .map((control) => control.name);
                const verticallyEscaped = controls
                    .filter((control) => control.top < headerBounds.top || control.bottom > headerBounds.bottom)
                    .map((control) => control.name);
                return { headerHeight: headerBounds.height, intersections, escaped, verticallyEscaped };
            });

            expect(geometry.headerHeight).toBe(88);
            expect(geometry.intersections, `${width}px overlaps`).toEqual([]);
            expect(geometry.escaped, `${width}px escape`).toEqual([]);
            expect(geometry.verticallyEscaped, `${width}px vertical escape`).toEqual([]);
        }

        await page.setViewportSize({ width: 512, height: 900 });
        await page.getByRole('button', { name: 'More transport controls' }).click();
        await expect(page.getByRole('button', { name: 'Punch recording settings' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Editing tools:/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Solo mode:/ })).toBeVisible();

        await page.getByRole('button', { name: 'Punch recording settings' }).click();
        await expect(page.getByLabel('Punch-in beat')).toBeVisible();
        await expect(page.getByLabel('Punch-out beat')).toBeVisible();

        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'More transport controls' }).click();
        await page.getByRole('button', { name: 'Transport settings' }).click();
        await expect(page.getByRole('button', { name: 'Overdub' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Metronome' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Punch in/out' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Count-in' })).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: 'Transport settings' })).toBeFocused();

        for (const width of [1024, 512]) {
            await page.setViewportSize({ width, height: 900 });
            await page.getByRole('button', { name: 'Project controls' }).click();
            await expect(page.getByRole('dialog', { name: 'Project controls' })).toBeVisible();
            await page.keyboard.press('Escape');
        }
    });

    test('does not duplicate compact actions when More is open', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.setViewportSize({ width: 819, height: 900 });

        await page.getByRole('button', { name: 'More transport controls' }).click();
        await expect(page.getByRole('button', { name: 'Auto-scroll follows playhead' })).toHaveCount(1);
        await expect(page.getByRole('button', { name: /Editing tools:/ })).toHaveCount(1);
        await expect(page.getByRole('button', { name: /Solo mode:/ })).toHaveCount(1);
        await expect(page.locator('button[aria-label="Undo"]:visible')).toHaveCount(1);

        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: /Editing tools:/ }).click();
        const tools = page.getByRole('radiogroup', { name: 'Editing tools' });
        await expect(tools).toHaveCount(1);
        await expect(tools.getByRole('radio')).toHaveCount(6);
        await expect(tools.locator('[role="radio"][aria-checked="true"]')).toHaveCount(1);
    });

    test('keeps More open across compact and minimal widths', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupWorkspace(page);
        await launch_new_project(page);
        await page.setViewportSize({ width: 819, height: 900 });

        await page.getByRole('button', { name: 'More transport controls' }).click();
        await expect(page.getByRole('button', { name: 'Punch recording settings' })).toBeVisible();
        await page.setViewportSize({ width: 683, height: 900 });
        await expect(page.getByRole('button', { name: 'Punch recording settings' })).toBeVisible();
    });

    test('reconciles transport disclosures across responsive transitions', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupWorkspace(page);
        await launch_new_project(page);

        await page.getByRole('button', { name: 'Transport settings' }).click();
        await expect(page.getByRole('dialog', { name: 'Transport settings' })).toHaveCount(1);
        await page.setViewportSize({ width: 1199, height: 900 });
        await expect(page.getByRole('dialog', { name: 'Transport settings' })).toHaveCount(1);
        await page.setViewportSize({ width: 1200, height: 900 });
        await expect(page.getByRole('dialog', { name: 'Transport settings' })).toHaveCount(1);
        await page.keyboard.press('Escape');

        await page.setViewportSize({ width: 1199, height: 900 });
        const moreTrigger = page.getByRole('button', { name: 'More transport controls' });
        await moreTrigger.click();
        await expect(page.getByRole('dialog', { name: 'More transport controls' })).toHaveCount(1);
        await page.getByRole('button', { name: 'Punch recording settings' }).focus();
        await page.keyboard.press('Escape');
        await expect(moreTrigger).toHaveAttribute('aria-expanded', 'false');
        await expect(moreTrigger).toBeFocused();

        await moreTrigger.click();
        await expect(page.getByRole('dialog', { name: 'More transport controls' })).toHaveCount(1);
        await page.setViewportSize({ width: 1200, height: 900 });
        await expect(page.getByRole('dialog', { name: 'More transport controls' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();
        await page.setViewportSize({ width: 1199, height: 900 });
        await page.getByRole('button', { name: 'More transport controls' }).click();
        await expect(page.getByRole('dialog', { name: 'More transport controls' })).toHaveCount(1);
    });

    test('unmounts mode-specific disclosures at the compact boundary', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupWorkspace(page);
        await launch_new_project(page);

        await page.setViewportSize({ width: 1199, height: 900 });
        await page.getByRole('button', { name: 'Project controls' }).click();
        await expect(page.getByRole('dialog', { name: 'Project controls' })).toHaveCount(1);
        await page.setViewportSize({ width: 1200, height: 900 });
        await expect(page.getByRole('dialog', { name: 'Project controls' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();

        await page.setViewportSize({ width: 1199, height: 900 });
        await page.getByRole('button', { name: 'View and panel controls' }).click();
        await expect(page.getByRole('dialog', { name: 'View and panel controls' })).toHaveCount(1);
        await page.setViewportSize({ width: 1200, height: 900 });
        await expect(page.getByRole('dialog', { name: 'View and panel controls' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();

        await page.setViewportSize({ width: 1199, height: 900 });
        await page.getByRole('button', { name: 'More transport controls' }).click();
        await page.getByRole('button', { name: /Editing tools:/ }).click();
        await expect(page.getByRole('dialog', { name: 'Editing tools' })).toHaveCount(1);
        await page.setViewportSize({ width: 1200, height: 900 });
        await expect(page.getByRole('dialog', { name: 'More transport controls' })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Editing tools' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();

        await page.setViewportSize({ width: 1199, height: 900 });
        await page.getByRole('button', { name: 'More transport controls' }).click();
        await page.getByRole('button', { name: /Solo mode:/ }).click();
        await expect(page.getByRole('dialog', { name: 'Solo mode' })).toHaveCount(1);
        await page.setViewportSize({ width: 1200, height: 900 });
        await expect(page.getByRole('dialog', { name: 'More transport controls' })).toHaveCount(0);
        await expect(page.getByRole('dialog', { name: 'Solo mode' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();

        await page.setViewportSize({ width: 1199, height: 900 });
        await page.getByRole('button', { name: 'More transport controls' }).click();
        await page.getByRole('button', { name: 'Punch recording settings' }).click();
        await expect(page.getByRole('dialog', { name: 'Punch recording settings' })).toHaveCount(1);
        await page.setViewportSize({ width: 1200, height: 900 });
        await expect(page.getByRole('dialog', { name: 'Punch recording settings' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Stop' })).toBeFocused();
    });
});
