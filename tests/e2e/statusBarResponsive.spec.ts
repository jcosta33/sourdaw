import { expect, test, type Frame, type Locator, type Page } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS } from './e2eUtils';

const OUTER_VIEWPORT = { width: 1150, height: 1264 };
const COMPACT_STATUS_BAR_MAX_WIDTH = 1199;
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const METRIC_LABELS = ['UI CPU', 'MEM', 'AI Model', 'Rate', 'Latency', 'Out'] as const;
const DEFERRED_METRIC_LABELS = ['UI CPU', 'MEM', 'AI Model', 'Out'] as const;

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type LabelGeometry = {
    label: string;
    labelRects: Rect[];
    group: Rect | null;
};
type StatusGeometry = {
    root: Rect | null;
    header: Rect | null;
    footer: Rect | null;
    strip: Rect | null;
    labels: LabelGeometry[];
    controls: Array<{ name: string; rect: Rect }>;
};

function requireValue<Value>(value: Value | null | undefined, label: string): Value {
    if (value === null || value === undefined) {
        throw new Error(`${label} is unavailable`);
    }
    return value;
}

async function findApplicationFrame(page: Page): Promise<Frame> {
    await expect(page.locator('iframe[title="Sourdaw"]')).toHaveCount(1);
    const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
    if (frame === undefined) {
        throw new Error('The browser display-scale host did not create an application frame');
    }
    return frame;
}

async function openPreferences(app: Locator, frame: Frame): Promise<void> {
    const compactTransport = await frame.evaluate(() => window.innerWidth <= 1199);
    if (compactTransport) {
        await app.getByRole('button', { name: 'View and panel controls' }).click();
        await app.getByRole('button', { name: 'Preferences', exact: true }).click();
        return;
    }
    await app.getByRole('button', { name: 'Open Preferences' }).click();
}

async function setDisplayScale(app: Locator, frame: Frame, scale: number): Promise<void> {
    await openPreferences(app, frame);
    const dialog = app.getByRole('dialog').filter({ hasText: /Preferences/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Appearance', exact: true }).click();

    const slider = dialog.getByRole('slider', { name: 'UI Scale' });
    await slider.press('Home');
    for (let step = 0; step < Math.round((scale - 0.5) / 0.05); step += 1) {
        await slider.press('ArrowRight');
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(scale * 100));
    await expect.poll(() => frame.evaluate(() => window.innerWidth)).toBe(Math.round(OUTER_VIEWPORT.width / scale));
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
}

async function runPaletteCommand(page: Page, app: Locator, label: string): Promise<void> {
    await page.keyboard.press(`${MODIFIER}+k`);
    const palette = app.getByRole('dialog', { name: /Command Palette/i });
    await expect(palette).toBeVisible();
    const input = palette.getByPlaceholder('Type a command...', { exact: true });
    await input.fill(label);
    await palette.getByRole('option', { name: new RegExp(`^${label}`) }).click();
    await expect(palette).toHaveCount(0);
}

async function statusGeometry(frame: Frame): Promise<StatusGeometry> {
    return frame.evaluate(
        (labels) => {
            const copy = (rect: DOMRect): Rect => ({
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                width: rect.width,
                height: rect.height,
            });
            const visible = (element: HTMLElement): boolean => {
                const style = window.getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            };
            const footer = document.querySelector<HTMLElement>('footer[aria-label="Application status"]');
            const strip = footer?.firstElementChild;
            const labelGeometry = labels.map((label) => {
                const element = Array.from(footer?.querySelectorAll<HTMLElement>('*') ?? []).find(
                    (candidate) => candidate.children.length === 0 && candidate.textContent?.trim() === label
                );
                return {
                    label,
                    labelRects: element === undefined ? [] : Array.from(element.getClientRects(), copy),
                    group:
                        element?.parentElement instanceof HTMLElement
                            ? copy(element.parentElement.getBoundingClientRect())
                            : null,
                };
            });
            const controls = Array.from(
                footer?.querySelectorAll<HTMLElement>(
                    'button, [role="status"], [title^="Engine:"], [aria-label^="Monitoring:"], [aria-label*="CV/Gate"]'
                ) ?? []
            )
                .filter(visible)
                .map((element) => ({
                    name:
                        element.getAttribute('aria-label') ??
                        element.getAttribute('title') ??
                        element.textContent?.trim() ??
                        '',
                    rect: copy(element.getBoundingClientRect()),
                }));
            return {
                root: document.querySelector<HTMLElement>('#root')
                    ? copy(document.querySelector<HTMLElement>('#root')!.getBoundingClientRect())
                    : null,
                header: document.querySelector<HTMLElement>('header')
                    ? copy(document.querySelector<HTMLElement>('header')!.getBoundingClientRect())
                    : null,
                footer: footer ? copy(footer.getBoundingClientRect()) : null,
                strip: strip ? copy(strip.getBoundingClientRect()) : null,
                labels: labelGeometry,
                controls,
            };
        },
        [...METRIC_LABELS]
    );
}

function intersects(first: Rect, second: Rect): boolean {
    return (
        first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
    );
}

function isContained(inner: Rect, outer: Rect): boolean {
    return (
        inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom
    );
}

function expectExpandedLayout(geometry: StatusGeometry): void {
    const strip = requireValue(geometry.strip, 'status strip');
    const missing = geometry.labels.filter((label) => label.labelRects.length === 0).map((label) => label.label);
    expect(missing, 'expanded metrics').toEqual([]);
    for (const label of geometry.labels) {
        expect(label.labelRects, `${label.label} label lines`).toHaveLength(1);
        expect(
            isContained(requireValue(label.group, `${label.label} group`), strip),
            `${label.label} group containment`
        ).toBe(true);
    }
    const intersections = geometry.labels.flatMap((label, index) =>
        geometry.labels
            .slice(index + 1)
            .flatMap((candidate) =>
                intersects(
                    requireValue(label.group, `${label.label} group`),
                    requireValue(candidate.group, `${candidate.label} group`)
                )
                    ? [`${label.label} / ${candidate.label}`]
                    : []
            )
    );
    expect(intersections, 'metric group intersections').toEqual([]);
}

function expectCompactEssentials(geometry: StatusGeometry): void {
    const footer = requireValue(geometry.footer, 'status footer');
    const names = geometry.controls.map((control) => control.name);
    expect(names.some((name) => name.startsWith('Engine:'))).toBe(true);
    expect(names).toContain('Monitoring: Mono active');
    expect(names).toContain('1 CV/Gate output configured');
    for (const label of geometry.labels.filter((label) => label.label === 'Rate' || label.label === 'Latency')) {
        expect(label.labelRects, `${label.label} direct label lines`).toHaveLength(1);
        expect(
            isContained(requireValue(label.group, `${label.label} group`), footer),
            `${label.label} containment`
        ).toBe(true);
    }
    for (const control of geometry.controls) {
        expect(isContained(control.rect, footer), `${control.name} containment`).toBe(true);
    }
    const intersections = geometry.controls.flatMap((control, index) =>
        geometry.controls
            .slice(index + 1)
            .flatMap((candidate) =>
                intersects(control.rect, candidate.rect) ? [`${control.name} / ${candidate.name}`] : []
            )
    );
    expect(intersections, 'essential status intersections').toEqual([]);
    expect(names).toContain('More application status');
}

for (const scale of [0.5, 1, 1.25, 2]) {
    test(`status footer contains essential status and defers remaining controls at ${scale} UI scale`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(240_000);
        const evidence: Record<string, unknown> = { outerViewport: OUTER_VIEWPORT, scale };
        await page.setViewportSize(OUTER_VIEWPORT);
        const alphaDismissed = superjsonStringify(true);
        await page.addInitScript((dismissed) => {
            if (window.parent !== window) {
                return;
            }
            window.localStorage.clear();
            window.localStorage.setItem('wd:onboarding-completed', '1');
            window.localStorage.setItem('sourdaw-alpha-notice-dismissed', dismissed);
            window.localStorage.setItem('wd:first-load-hint-shown', '1');
        }, alphaDismissed);

        try {
            await page.goto('/');
            const frame = await findApplicationFrame(page);
            const app = page.frameLocator('iframe[title="Sourdaw"]');
            await expect(app.getByLabel('Sourdaw — start a project')).toBeVisible({
                timeout: LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS,
            });
            await app.locator('#launch-new-project').click();
            await expect(app.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
            await setDisplayScale(app, frame, scale);
            await runPaletteCommand(page, app, 'Toggle Mono Monitoring');
            await runPaletteCommand(page, app, 'Add CV Pitch Output');

            const width = await frame.evaluate(() => window.innerWidth);
            evidence.effectiveWidth = width;
            const geometry = await statusGeometry(frame);
            evidence.geometry = geometry;

            if (width <= COMPACT_STATUS_BAR_MAX_WIDTH) {
                expectCompactEssentials(geometry);
                const more = app.getByRole('button', { name: 'More application status' });
                await more.click();
                const details = app.getByRole('dialog', { name: 'More application status' });
                await expect(details).toBeVisible();
                for (const label of DEFERRED_METRIC_LABELS) {
                    await expect(details.getByText(label, { exact: true })).toBeVisible();
                }
                await expect(details.getByRole('button', { name: 'Third-party licenses' })).toBeVisible();
                await expect(details.getByRole('button', { name: 'Project links' })).toBeVisible();
                await expect(details.getByRole('button', { name: 'Toggle collaboration panel' })).toBeVisible();
                await expect(details.getByRole('button', { name: 'Toggle undo history panel' })).toBeVisible();
                const memoryReadout = details
                    .getByText('MEM', { exact: true })
                    .locator('..')
                    .getByText(/ MB$/, { exact: true });
                await expect.poll(async () => memoryReadout.innerText()).not.toBe('0 MB');
                const projectLinks = details.getByRole('button', { name: 'Project links' });
                await projectLinks.click();
                await expect(app.getByRole('menuitem', { name: 'Source' })).toBeVisible();
                await app.locator('body').press('Escape');
                await expect(app.getByRole('menuitem', { name: 'Source' })).toHaveCount(0);
                await expect(details).toBeVisible();
                await expect(projectLinks).toBeFocused();
                await projectLinks.press('Escape');
                await expect(details).toHaveCount(0);
                await expect(more).toBeFocused();
                await more.click();
                await expect(details).toBeVisible();
                await expect.poll(async () => memoryReadout.innerText()).not.toBe('0 MB');
                await page.setViewportSize({
                    width: (COMPACT_STATUS_BAR_MAX_WIDTH + 1) * scale,
                    height: OUTER_VIEWPORT.height,
                });
                await expect(details).toHaveCount(0);
                await expect(app.getByRole('button', { name: 'Project links' })).toBeFocused();
                await page.setViewportSize(OUTER_VIEWPORT);
                await expect(more).toBeFocused();
                await more.click();
                await expect(details).toBeVisible();
                const remountedMemoryReadout = details
                    .getByText('MEM', { exact: true })
                    .locator('..')
                    .getByText(/ MB$/, { exact: true });
                await expect.poll(async () => remountedMemoryReadout.innerText()).not.toBe('0 MB');
            } else {
                expectExpandedLayout(geometry);
            }
        } finally {
            await testInfo.attach('status-footer-geometry', {
                body: Buffer.from(JSON.stringify(evidence, null, 2)),
                contentType: 'application/json',
            });
        }
    });
}
