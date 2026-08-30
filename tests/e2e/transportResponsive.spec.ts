import { expect, test } from '@playwright/test';

import { launch_new_project, setupWorkspace } from './e2eUtils';

const effectiveWidths = [1440, 1024, 819, 683, 640, 512];

test.describe('Responsive transport bar', () => {
    test('keeps topbar controls visible and non-overlapping at every supported effective width', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1440, height: 900 });
        await setupWorkspace(page);
        await launch_new_project(page);

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
                return { headerHeight: headerBounds.height, intersections, escaped };
            });

            expect(geometry.headerHeight).toBe(88);
            expect(geometry.intersections, `${width}px overlaps`).toEqual([]);
            expect(geometry.escaped, `${width}px escape`).toEqual([]);
        }

        await page.getByRole('button', { name: 'More transport controls' }).click();
        await expect(page.getByRole('button', { name: 'Punch recording settings' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Editing tools:/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Solo mode:/ })).toBeVisible();

        await page.getByRole('button', { name: 'Punch recording settings' }).click();
        await expect(page.getByLabel('Punch-in beat')).toBeVisible();
        await expect(page.getByLabel('Punch-out beat')).toBeVisible();
    });
});
