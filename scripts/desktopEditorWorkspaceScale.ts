import assert from 'node:assert/strict';

import { type Locator, type Page } from 'playwright';

import { exactButton } from './desktopEditorFamilyDrive.ts';
import { type ScaleStep, type WorkspaceObservation } from './desktopEditorWorkspaceEvidence.ts';

export async function viewport(page: Page): Promise<[number, number, number]> {
    return await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
}

export async function changeScale(page: Page, percent: number, row?: WorkspaceObservation): Promise<void> {
    const run = async (name: ScaleStep, action: () => Promise<void>): Promise<void> => {
        if (row) {
            await scaleStep(row, name, action);
        } else {
            await action();
        }
    };
    await run('preferences-open', async () => {
        const wide = page.getByRole('button', { name: 'Open Preferences', exact: true });
        const compact = page.getByRole('button', { name: 'View and panel controls', exact: true });
        await wide.or(compact).waitFor({ state: 'visible' });
        if (await wide.isVisible()) {
            await wide.click();
        } else {
            await compact.click();
            const popover = page.getByRole('dialog', { name: 'View and panel controls', exact: true });
            await exactButton(popover, 'Preferences').click();
        }
    });
    const preferences = page.getByRole('dialog', { name: 'Preferences', exact: true });
    await run('preferences-appearance', () => exactButton(preferences, 'Appearance').click());
    const slider = preferences.getByRole('slider', { name: 'UI Scale', exact: true });
    // A fresh isolated profile starts at 100%; each Arrow commits a real preference change.
    await run('preferences-scale', async () => {
        const old = Number(await slider.getAttribute('aria-valuenow'));
        assert(old === 100 || old === 125);
        const key = percent > old ? 'ArrowRight' : 'ArrowLeft';
        for (let current = old; current !== percent; current += percent > old ? 5 : -5) {
            await slider.press(key);
        }
        assert.equal(Number(await slider.getAttribute('aria-valuenow')), percent);
    });
    await run('preferences-dismiss', async () => {
        await exactButton(preferences, 'Done').click();
        await preferences.waitFor({ state: 'detached' });
    });
}

export async function scaleStep(
    row: WorkspaceObservation,
    name: ScaleStep,
    action: (entry: WorkspaceObservation['scaleSteps'][number]) => Promise<void>
): Promise<void> {
    const entry: WorkspaceObservation['scaleSteps'][number] = { name, outcome: 'failed' };
    row.scaleSteps.push(entry);
    await action(entry);
    entry.outcome = 'passed';
}

export async function observedClick(target: Locator, row: WorkspaceObservation, name: ScaleStep): Promise<void> {
    await scaleStep(row, name, async (entry) => {
        entry.hit = null;
        entry.received = null;
        const witness = await target
            .evaluateHandle(
                (element) => {
                    const rect = element.getBoundingClientRect();
                    const x = rect.x + rect.width / 2;
                    const y = rect.y + rect.height / 2;
                    const hit = document.elementFromPoint(x, y);
                    const state = {
                        x,
                        y,
                        hit: hit !== null && (hit === element || element.contains(hit)),
                        received: false,
                    };
                    const listener = (event: Event): void => {
                        state.received = event.isTrusted;
                    };
                    element.addEventListener('click', listener, { capture: true, once: true });
                    return { state, cleanup: () => element.removeEventListener('click', listener, true) };
                },
                undefined,
                { timeout: 1000 }
            )
            .catch(() => null);
        if (witness) {
            try {
                Object.assign(entry, await witness.evaluate(({ state }) => state));
            } catch {
                // The real click still decides the step.
            }
        }
        try {
            await target.click();
        } finally {
            if (witness) {
                try {
                    Object.assign(
                        entry,
                        await witness.evaluate(({ state, cleanup }) => {
                            cleanup();
                            return state;
                        })
                    );
                } catch {
                    entry.received = null;
                } finally {
                    await witness.dispose().catch(() => {});
                }
            }
        }
    });
}
