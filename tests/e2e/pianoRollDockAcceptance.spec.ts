import { readFile } from 'node:fs/promises';

import { expect, test, type Frame, type Page, type TestInfo } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS } from './e2eUtils';

const OUTER_VIEWPORT = { width: 1150, height: 1264 };
const RULER_HEIGHT = 22;
const ROW_HEIGHT = 16;
const BEAT_WIDTH = 40;
const GRID_SNAP = 1;
const MIN_USABLE_VIEWPORT_HEIGHT = RULER_HEIGHT + 3 * ROW_HEIGHT;
const COMPACT_TRANSPORT_MAX_WIDTH = 1199;

type Rect = { x: number; y: number; width: number; height: number };
type Note = { id: string; pitch: number; startBeat: number; duration: number };
type ProjectSnapshot = { midi: { notesByClipId: Record<string, Note[]> } };
type ElementDiagnostic = {
    tagName: string;
    id: string;
    className: string;
    rect: Rect;
    styles: Record<string, string>;
    scroll: { left: number; top: number; width: number; height: number; clientWidth: number; clientHeight: number };
};
type CanvasDiagnostic = { canvas: ElementDiagnostic; ancestors: ElementDiagnostic[] };
type ToolbarControlDiagnostic = {
    label: string;
    tagName: string;
    disabled: boolean;
    rect: Rect;
    withinToolbarViewport: boolean;
    centerHit: string | null;
};
type ToolbarDiagnostic = {
    stage: string;
    root: ElementDiagnostic;
    toolbarViewport: ElementDiagnostic;
    toolbar: ElementDiagnostic;
    controls: ToolbarControlDiagnostic[];
    activeElement: string | null;
};
type PianoRollGeometry = {
    canvas: Rect;
    dockHeight: number;
    scrollLeft: number;
    scrollTop: number;
    scrollClientHeight: number;
    visibleHeight: number;
    visibleRect: Rect;
    diagnostic: {
        canvases: CanvasDiagnostic[];
        targetAncestors: ElementDiagnostic[];
        visibleScrollCenter: { point: { x: number; y: number }; element: ElementDiagnostic | null };
        pageScroll: { x: number; y: number; documentLeft: number; documentTop: number };
        viewport: { width: number; height: number };
    };
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

async function setDisplayScale(frame: Frame, scale: number): Promise<void> {
    const compactTransport = await frame.evaluate(
        (maxWidth) => window.innerWidth <= maxWidth,
        COMPACT_TRANSPORT_MAX_WIDTH
    );
    if (compactTransport) {
        await frame.getByRole('button', { name: 'View and panel controls' }).click();
        await frame.getByRole('button', { name: 'Preferences', exact: true }).click();
    } else {
        await frame.getByRole('button', { name: 'Open Preferences' }).click();
    }
    const dialog = frame.getByRole('dialog').filter({ hasText: /Preferences/i });
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

async function framePointToPage(
    page: Page,
    scale: number,
    point: { x: number; y: number }
): Promise<{ x: number; y: number }> {
    const frameBox = requireValue(await page.locator('iframe[title="Sourdaw"]').boundingBox(), 'application frame box');
    return { x: frameBox.x + point.x * scale, y: frameBox.y + point.y * scale };
}

async function mouseClickInFrame(
    page: Page,
    scale: number,
    point: { x: number; y: number },
    options: { button?: 'left' | 'right'; clickCount?: number } = {}
): Promise<void> {
    const target = await framePointToPage(page, scale, point);
    await page.mouse.click(target.x, target.y, options);
}

async function mouseWheelInFrame(
    page: Page,
    scale: number,
    point: { x: number; y: number },
    deltaX: number,
    deltaY: number
): Promise<void> {
    const target = await framePointToPage(page, scale, point);
    await page.mouse.move(target.x, target.y);
    await page.mouse.wheel(deltaX, deltaY);
}

async function mouseDragInFrame(
    page: Page,
    scale: number,
    from: { x: number; y: number },
    to: { x: number; y: number }
): Promise<void> {
    const start = await framePointToPage(page, scale, from);
    const end = await framePointToPage(page, scale, to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();
}

async function pianoRollGeometry(frame: Frame): Promise<PianoRollGeometry> {
    return frame.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Piano roll editor"]');
        if (canvas === null) {
            throw new Error('Piano roll canvas is unavailable');
        }
        let scroll: HTMLElement | null = canvas.parentElement;
        while (scroll !== null && window.getComputedStyle(scroll).overflowY !== 'auto') {
            scroll = scroll.parentElement;
        }
        if (scroll === null) {
            throw new Error('Piano roll scroll viewport is unavailable');
        }
        const tabPanel = document.getElementById('bottom-dock-tabpanel');
        const dock = tabPanel?.parentElement;
        if (dock === null || dock === undefined) {
            throw new Error('Bottom dock is unavailable');
        }

        const copyRect = (rect: DOMRect): Rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        const describeElement = (element: Element): ElementDiagnostic => {
            const htmlElement = element as HTMLElement;
            const style = window.getComputedStyle(element);
            return {
                tagName: element.tagName,
                id: htmlElement.id,
                className: element.getAttribute('class') ?? '',
                rect: copyRect(htmlElement.getBoundingClientRect()),
                styles: {
                    contain: style.contain,
                    display: style.display,
                    flex: style.flex,
                    flexBasis: style.flexBasis,
                    flexShrink: style.flexShrink,
                    left: style.left,
                    minWidth: style.minWidth,
                    overflow: style.overflow,
                    overflowX: style.overflowX,
                    overflowY: style.overflowY,
                    position: style.position,
                    transform: style.transform,
                    width: style.width,
                },
                scroll: {
                    left: htmlElement.scrollLeft,
                    top: htmlElement.scrollTop,
                    width: htmlElement.scrollWidth,
                    height: htmlElement.scrollHeight,
                    clientWidth: htmlElement.clientWidth,
                    clientHeight: htmlElement.clientHeight,
                },
            };
        };
        const ancestorChain = (element: Element): ElementDiagnostic[] => {
            const ancestors: ElementDiagnostic[] = [];
            for (let owner: Element | null = element; owner !== null; owner = owner.parentElement) {
                ancestors.push(describeElement(owner));
            }
            return ancestors;
        };
        const intersection = (first: Rect, second: Rect): Rect => {
            const left = Math.max(first.x, second.x);
            const top = Math.max(first.y, second.y);
            const right = Math.min(first.x + first.width, second.x + second.width);
            const bottom = Math.min(first.y + first.height, second.y + second.height);
            return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
        };
        let visible = intersection(copyRect(scroll.getBoundingClientRect()), {
            x: 0,
            y: 0,
            width: window.innerWidth,
            height: window.innerHeight,
        });
        for (let ancestor = scroll.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
            const style = window.getComputedStyle(ancestor);
            if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowY}`)) {
                visible = intersection(visible, copyRect(ancestor.getBoundingClientRect()));
            }
        }
        const scrollRect = copyRect(scroll.getBoundingClientRect());
        const centerRect = visible.width > 0 && visible.height > 0 ? visible : scrollRect;
        const centerPoint = { x: centerRect.x + centerRect.width / 2, y: centerRect.y + centerRect.height / 2 };
        const centerElement = document.elementFromPoint(centerPoint.x, centerPoint.y);
        const canvasDiagnostics = Array.from(
            document.querySelectorAll<HTMLCanvasElement>('canvas[aria-label="Piano roll editor"]')
        ).map((candidate) => ({ canvas: describeElement(candidate), ancestors: ancestorChain(candidate) }));
        return {
            canvas: copyRect(canvas.getBoundingClientRect()),
            dockHeight: dock.getBoundingClientRect().height,
            scrollLeft: scroll.scrollLeft,
            scrollTop: scroll.scrollTop,
            scrollClientHeight: scroll.clientHeight,
            visibleHeight: visible.height,
            visibleRect: visible,
            diagnostic: {
                canvases: canvasDiagnostics,
                targetAncestors: ancestorChain(canvas),
                visibleScrollCenter: {
                    point: centerPoint,
                    element: centerElement === null ? null : describeElement(centerElement),
                },
                pageScroll: {
                    x: window.scrollX,
                    y: window.scrollY,
                    documentLeft: document.scrollingElement?.scrollLeft ?? 0,
                    documentTop: document.scrollingElement?.scrollTop ?? 0,
                },
                viewport: { width: window.innerWidth, height: window.innerHeight },
            },
        };
    });
}

function intersectRects(first: Rect, second: Rect): Rect {
    const left = Math.max(first.x, second.x);
    const top = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function pointInside(rect: Rect, point: { x: number; y: number }, label: string): void {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    if (point.x < rect.x || point.x > right || point.y < rect.y || point.y > bottom) {
        throw new Error(`${label} is outside the visible piano-roll canvas: ${JSON.stringify({ point, rect })}`);
    }
}

function visibleCanvas(geometry: PianoRollGeometry): Rect {
    const rect = intersectRects(geometry.canvas, geometry.visibleRect);
    if (rect.width < BEAT_WIDTH * 4 || rect.height < RULER_HEIGHT + ROW_HEIGHT * 3) {
        throw new Error(
            `Piano-roll viewport cannot fit a complete draw, move, and resize gesture: ${JSON.stringify({ geometry, rect })}`
        );
    }
    return rect;
}

function visibleDrawPoint(geometry: PianoRollGeometry, rect: Rect): { x: number; y: number } {
    const usableTop = geometry.canvas.y + RULER_HEIGHT;
    const firstVisibleRow = Math.ceil((rect.y - usableTop) / ROW_HEIGHT);
    const row = Math.max(1, firstVisibleRow + 1);
    const y = usableTop + (row + 0.5) * ROW_HEIGHT;
    const adjacentRowY = y - ROW_HEIGHT;
    const x = rect.x + BEAT_WIDTH * 2;
    pointInside(rect, { x, y: y - ROW_HEIGHT / 2 }, 'draw row top');
    pointInside(rect, { x, y: y + ROW_HEIGHT / 2 }, 'draw row bottom');
    pointInside(rect, { x, y: adjacentRowY - ROW_HEIGHT / 2 }, 'adjacent row top');
    pointInside(rect, { x, y: adjacentRowY + ROW_HEIGHT / 2 }, 'adjacent row bottom');
    pointInside(rect, { x: x + BEAT_WIDTH * 2, y }, 'resize destination margin');
    return { x, y };
}

async function attachGeometryDiagnostic(
    page: Page,
    testInfo: TestInfo,
    condition: string,
    scale: number,
    geometry: PianoRollGeometry
): Promise<void> {
    const visibleCanvasRect = intersectRects(geometry.canvas, geometry.visibleRect);
    let drawPoint: { x: number; y: number } | null = null;
    let drawPointFailure: string | null = null;
    try {
        drawPoint = visibleDrawPoint(geometry, visibleCanvasRect);
    } catch (error) {
        drawPointFailure = error instanceof Error ? error.message : String(error);
    }
    const iframeBox = await page.locator('iframe[title="Sourdaw"]').boundingBox();
    const outerPage = await page.evaluate(() => ({
        documentLeft: document.scrollingElement?.scrollLeft ?? 0,
        documentTop: document.scrollingElement?.scrollTop ?? 0,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        viewport: { width: window.innerWidth, height: window.innerHeight },
    }));
    await testInfo.attach(`piano-roll-${condition}-geometry`, {
        body: JSON.stringify(
            { scale, geometry, visibleCanvasRect, drawPoint, drawPointFailure, iframeBox, outerPage },
            null,
            2
        ),
        contentType: 'application/json',
    });
    const screenshotPath = testInfo.outputPath(`piano-roll-${condition}-geometry.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`piano-roll-${condition}-geometry-screenshot`, {
        path: screenshotPath,
        contentType: 'image/png',
    });
}

async function exportProject(frame: Frame, page: Page): Promise<ProjectSnapshot> {
    expect(await frame.evaluate(() => 'showSaveFilePicker' in window)).toBe(false);
    const downloadStarted = page.waitForEvent('download', { timeout: 20_000 });
    await frame.getByRole('button', { name: 'Project menu' }).click();
    await frame.getByRole('menuitem', { name: 'Export Project File…' }).click();
    const download = await downloadStarted;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.sourdaw$/i);
    const path = requireValue(await download.path(), 'exported project download path');
    return JSON.parse(await readFile(path, 'utf8')) as ProjectSnapshot;
}

async function toolbarDiagnostic(frame: Frame, stage: string): Promise<ToolbarDiagnostic> {
    return frame.evaluate((diagnosticStage) => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Piano roll editor"]');
        if (canvas === null) {
            throw new Error('Piano roll canvas is unavailable for toolbar diagnostic');
        }
        const copyRect = (rect: DOMRect): Rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        const describeElement = (element: Element): ElementDiagnostic => {
            const htmlElement = element as HTMLElement;
            const style = window.getComputedStyle(element);
            return {
                tagName: element.tagName,
                id: htmlElement.id,
                className: element.getAttribute('class') ?? '',
                rect: copyRect(htmlElement.getBoundingClientRect()),
                styles: {
                    contain: style.contain,
                    display: style.display,
                    flex: style.flex,
                    flexBasis: style.flexBasis,
                    flexShrink: style.flexShrink,
                    left: style.left,
                    minWidth: style.minWidth,
                    overflow: style.overflow,
                    overflowX: style.overflowX,
                    overflowY: style.overflowY,
                    position: style.position,
                    transform: style.transform,
                    width: style.width,
                },
                scroll: {
                    left: htmlElement.scrollLeft,
                    top: htmlElement.scrollTop,
                    width: htmlElement.scrollWidth,
                    height: htmlElement.scrollHeight,
                    clientWidth: htmlElement.clientWidth,
                    clientHeight: htmlElement.clientHeight,
                },
            };
        };
        const intersects = (first: DOMRect, second: DOMRect): boolean =>
            first.left < second.right &&
            first.right > second.left &&
            first.top < second.bottom &&
            first.bottom > second.top;
        let root: HTMLElement | null = canvas.parentElement;
        let toolbarViewport: HTMLElement | null = null;
        while (root !== null) {
            const matchingViewport = Array.from(root.children).find((child) =>
                child.querySelector(':scope > .daw-control-strip')
            );
            toolbarViewport = matchingViewport instanceof HTMLElement ? matchingViewport : null;
            if (toolbarViewport !== null) {
                break;
            }
            root = root.parentElement;
        }
        if (root === null || toolbarViewport === null) {
            throw new Error('Piano roll toolbar owner is unavailable');
        }
        const toolbar = toolbarViewport.querySelector<HTMLElement>(':scope > .daw-control-strip');
        if (toolbar === null) {
            throw new Error('Piano roll toolbar is unavailable');
        }
        const toolbarViewportRect = toolbarViewport.getBoundingClientRect();
        const controls = Array.from(toolbar.querySelectorAll<HTMLElement>('button, select, input')).map((control) => {
            const rect = control.getBoundingClientRect();
            const centerX = rect.x + rect.width / 2;
            const centerY = rect.y + rect.height / 2;
            const hit =
                centerX >= toolbarViewportRect.left &&
                centerX <= toolbarViewportRect.right &&
                centerY >= toolbarViewportRect.top &&
                centerY <= toolbarViewportRect.bottom
                    ? document.elementFromPoint(centerX, centerY)
                    : null;
            return {
                label: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
                tagName: control.tagName,
                disabled: control.matches(':disabled'),
                rect: copyRect(rect),
                withinToolbarViewport: intersects(rect, toolbarViewportRect),
                centerHit:
                    hit === null ? null : (hit.getAttribute('aria-label') ?? hit.textContent?.trim() ?? hit.tagName),
            };
        });
        const active = document.activeElement;
        return {
            stage: diagnosticStage,
            root: describeElement(root),
            toolbarViewport: describeElement(toolbarViewport),
            toolbar: describeElement(toolbar),
            controls,
            activeElement:
                active instanceof HTMLElement
                    ? (active.getAttribute('aria-label') ?? active.textContent?.trim() ?? active.tagName)
                    : null,
        };
    }, stage);
}

async function attachToolbarDiagnostics(
    page: Page,
    testInfo: TestInfo,
    diagnostics: ToolbarDiagnostic[]
): Promise<void> {
    await testInfo.attach('piano-roll-toolbar-scroll-diagnostic', {
        body: JSON.stringify(diagnostics, null, 2),
        contentType: 'application/json',
    });
    const screenshotPath = testInfo.outputPath('piano-roll-toolbar-scroll-diagnostic.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('piano-roll-toolbar-scroll-diagnostic-screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
    });
}

async function assertToolbarScrollIsolation(
    page: Page,
    frame: Frame,
    scale: number,
    testInfo: TestInfo
): Promise<void> {
    const diagnostics = [await toolbarDiagnostic(frame, 'toolbar-initial')];
    let initial = diagnostics[0];
    if (initial === undefined) {
        throw new Error('Initial toolbar diagnostic is unavailable');
    }
    if (initial.toolbarViewport.scroll.left > 0) {
        const toolbarCenter = {
            x: initial.toolbarViewport.rect.x + initial.toolbarViewport.rect.width / 2,
            y: initial.toolbarViewport.rect.y + initial.toolbarViewport.rect.height / 2,
        };
        await mouseWheelInFrame(page, scale, toolbarCenter, -2_000, 0);
        await expect
            .poll(
                async () => (await toolbarDiagnostic(frame, 'toolbar-initial-after-wheel')).toolbarViewport.scroll.left
            )
            .toBe(0);
        initial = await toolbarDiagnostic(frame, 'toolbar-initial-after-wheel');
        diagnostics.push(initial);
    }
    expect(initial.root.scroll.left).toBe(0);
    const toolbarOverflows = initial.toolbarViewport.scroll.width > initial.toolbarViewport.scroll.clientWidth;
    const controlLabels = initial.controls.map((control) => control.label);
    expect(controlLabels).toContain('1');
    expect(controlLabels).toContain('Toggle paint mode');

    const snapControl = initial.controls.find((control) => control.label === '1');
    if (snapControl === undefined) {
        throw new Error('Snap control is unavailable');
    }
    await mouseClickInFrame(page, scale, {
        x: snapControl.rect.x + snapControl.rect.width / 2,
        y: snapControl.rect.y + snapControl.rect.height / 2,
    });
    for (const control of initial.controls) {
        if (control.tagName === 'BUTTON') {
            await frame.getByRole('button', { name: control.label, exact: true }).focus();
        } else {
            await frame.getByLabel(control.label, { exact: true }).focus();
        }
        const diagnostic = await toolbarDiagnostic(frame, `toolbar-focus-${control.label}`);
        diagnostics.push(diagnostic);
        expect(diagnostic.activeElement).toBe(control.label);
        const focusedControl = diagnostic.controls.find((candidate) => candidate.label === control.label);
        expect(focusedControl?.withinToolbarViewport).toBe(true);
        expect(diagnostic.root.scroll.left).toBe(0);
        expect((await pianoRollGeometry(frame)).scrollLeft).toBe(0);
    }

    const afterFocus = diagnostics.at(-1);
    if (afterFocus === undefined) {
        throw new Error('Focused toolbar diagnostic is unavailable');
    }
    if (toolbarOverflows) {
        expect(afterFocus.toolbarViewport.scroll.left).toBeGreaterThan(0);
        const toolbarCenter = {
            x: afterFocus.toolbarViewport.rect.x + afterFocus.toolbarViewport.rect.width / 2,
            y: afterFocus.toolbarViewport.rect.y + afterFocus.toolbarViewport.rect.height / 2,
        };
        await mouseWheelInFrame(page, scale, toolbarCenter, -2_000, 0);
        await expect
            .poll(async () => (await toolbarDiagnostic(frame, 'toolbar-after-wheel')).toolbarViewport.scroll.left)
            .toBe(0);
        const afterWheel = await toolbarDiagnostic(frame, 'toolbar-after-wheel');
        diagnostics.push(afterWheel);
        expect(afterWheel.root.scroll.left).toBe(0);
        expect((await pianoRollGeometry(frame)).scrollLeft).toBe(0);
        expect(afterWheel.controls.find((control) => control.label === '1')?.withinToolbarViewport).toBe(true);
    }
    await attachToolbarDiagnostics(page, testInfo, diagnostics);
}

function noteById(snapshot: ProjectSnapshot, id: string): Note {
    for (const notes of Object.values(snapshot.midi.notesByClipId)) {
        const note = notes.find((candidate) => candidate.id === id);
        if (note !== undefined) {
            return note;
        }
    }
    throw new Error(`Exported project does not contain note ${id}`);
}

function latestNote(snapshot: ProjectSnapshot): Note {
    const notes = Object.values(snapshot.midi.notesByClipId).flat();
    const note = notes[notes.length - 1];
    if (note === undefined) {
        throw new Error('Exported project contains no MIDI notes');
    }
    return note;
}

async function openPianoRoll(page: Page, frame: Frame, scale: number, testInfo: TestInfo): Promise<void> {
    await frame.getByRole('button', { name: /Add blank MIDI track/i }).click();
    const timeline = await frame.evaluate(() => {
        const surface = document.querySelector<HTMLElement>('[aria-label="Timeline editor surface"]');
        if (surface === null) {
            throw new Error('Timeline editor surface is unavailable');
        }
        const rect = surface.getBoundingClientRect();
        return { x: rect.x + Math.min(80, rect.width / 2), y: rect.y + Math.min(30, rect.height / 2) };
    });
    await mouseClickInFrame(page, scale, timeline, { button: 'right' });
    await frame.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(frame.getByText(/New midi clip/i).first()).toBeVisible();
    await mouseClickInFrame(page, scale, timeline, { clickCount: 2 });
    await expect(frame.getByLabel('Piano roll editor')).toBeVisible();
    const diagnostics = [await toolbarDiagnostic(frame, 'before-toggle-paint')];
    const beforePaint = requireValue(diagnostics[0], 'toolbar diagnostic before Paint');
    const paintControl = requireValue(
        beforePaint.controls.find((control) => control.label === 'Toggle paint mode'),
        'Paint control before activation'
    );
    const paintStartsOutsideToolbarViewport =
        paintControl.rect.x < beforePaint.toolbarViewport.rect.x ||
        paintControl.rect.x + paintControl.rect.width >
            beforePaint.toolbarViewport.rect.x + beforePaint.toolbarViewport.rect.width;
    await frame.getByRole('button', { name: 'Toggle paint mode' }).click();
    diagnostics.push(await toolbarDiagnostic(frame, 'after-toggle-paint'));
    for (const diagnostic of diagnostics) {
        expect(diagnostic.root.scroll.left).toBe(0);
    }
    const afterPaint = requireValue(diagnostics.at(-1), 'toolbar diagnostic after Paint');
    if (paintStartsOutsideToolbarViewport) {
        expect(afterPaint.toolbarViewport.scroll.left).toBeGreaterThan(0);
    } else {
        expect(afterPaint.toolbarViewport.scroll.left).toBe(0);
    }
    expect((await pianoRollGeometry(frame)).scrollLeft).toBe(0);
    await assertToolbarScrollIsolation(page, frame, scale, testInfo);
    await attachToolbarDiagnostics(page, testInfo, diagnostics);
    await expect(frame.getByRole('button', { name: 'Toggle paint mode' })).toHaveAttribute('aria-pressed', 'true');
}

async function dragDockToMinimum(page: Page, frame: Frame, scale: number): Promise<void> {
    const handle = await frame.evaluate(() => {
        const tabPanel = document.getElementById('bottom-dock-tabpanel');
        const dock = tabPanel?.parentElement;
        const separator = dock?.previousElementSibling;
        if (!(separator instanceof HTMLElement) || separator.getAttribute('role') !== 'separator') {
            throw new Error('Bottom dock resize handle is unavailable');
        }
        const rect = separator.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, bottom: window.innerHeight - 1 };
    });
    await mouseDragInFrame(page, scale, handle, { x: handle.x, y: handle.bottom });
    await expect.poll(async () => (await pianoRollGeometry(frame)).dockHeight).toBe(280);
}

async function assertCondition(
    page: Page,
    frame: Frame,
    scale: number,
    expressionVisible: boolean,
    testInfo: TestInfo,
    condition: string
): Promise<void> {
    const evidence: Record<string, unknown> = { condition, scale, expressionVisible, gestures: {} };
    const expressionToggle = frame.getByRole('button', { name: /Toggle Expression View/i });
    const expressionLane = frame.getByRole('combobox', { name: 'Active expression lane' });
    try {
        if (expressionVisible) {
            await expressionToggle.click();
            await expect(expressionToggle).toHaveAttribute('aria-pressed', 'true');
            await expect(expressionLane).toBeVisible();
        } else {
            await expect(expressionToggle).toHaveAttribute('aria-pressed', 'false');
            await expect(expressionLane).toHaveCount(0);
        }

        const geometry = await pianoRollGeometry(frame);
        evidence.geometry = geometry;
        await attachGeometryDiagnostic(page, testInfo, condition, scale, geometry);
        expect(geometry.scrollClientHeight).toBeGreaterThanOrEqual(MIN_USABLE_VIEWPORT_HEIGHT);
        expect(geometry.visibleHeight).toBeGreaterThanOrEqual(MIN_USABLE_VIEWPORT_HEIGHT);
        const initialVisibleCanvas = visibleCanvas(geometry);
        evidence.initialVisibleCanvas = initialVisibleCanvas;
        const drawPoint = visibleDrawPoint(geometry, initialVisibleCanvas);
        (evidence.gestures as Record<string, unknown>).draw = drawPoint;
        await mouseClickInFrame(page, scale, drawPoint);
        const drawn = latestNote(await exportProject(frame, page));
        evidence.drawn = drawn;
        expect(drawn.duration).toBe(GRID_SNAP);

        const afterDrawGeometry = await pianoRollGeometry(frame);
        evidence.afterDrawGeometry = afterDrawGeometry;
        const afterDrawVisibleCanvas = visibleCanvas(afterDrawGeometry);
        evidence.afterDrawVisibleCanvas = afterDrawVisibleCanvas;
        const drawLocalY = drawPoint.y - geometry.canvas.y;
        const noteBody = {
            x:
                afterDrawGeometry.canvas.x +
                drawn.startBeat * BEAT_WIDTH +
                (drawn.duration * BEAT_WIDTH) / 2 -
                afterDrawGeometry.scrollLeft,
            y: afterDrawGeometry.canvas.y + drawLocalY,
        };
        const moveEnd = { x: noteBody.x, y: noteBody.y - ROW_HEIGHT };
        pointInside(afterDrawVisibleCanvas, noteBody, 'note body');
        pointInside(afterDrawVisibleCanvas, moveEnd, 'move destination');
        (evidence.gestures as Record<string, unknown>).move = { start: noteBody, end: moveEnd };
        await mouseDragInFrame(page, scale, noteBody, moveEnd);
        const moved = noteById(await exportProject(frame, page), drawn.id);
        evidence.moved = moved;
        expect(moved.startBeat).toBe(drawn.startBeat);
        expect(moved.pitch).toBe(drawn.pitch + 1);
        expect(moved.duration).toBe(drawn.duration);

        const afterMoveGeometry = await pianoRollGeometry(frame);
        evidence.afterMoveGeometry = afterMoveGeometry;
        const afterMoveVisibleCanvas = visibleCanvas(afterMoveGeometry);
        evidence.afterMoveVisibleCanvas = afterMoveVisibleCanvas;
        const resizeStart = {
            x:
                afterMoveGeometry.canvas.x +
                (moved.startBeat + moved.duration) * BEAT_WIDTH -
                2 -
                afterMoveGeometry.scrollLeft,
            y: afterMoveGeometry.canvas.y + drawLocalY - ROW_HEIGHT,
        };
        const resizeEnd = { x: resizeStart.x + BEAT_WIDTH * GRID_SNAP, y: resizeStart.y };
        pointInside(afterMoveVisibleCanvas, resizeStart, 'resize start');
        pointInside(afterMoveVisibleCanvas, resizeEnd, 'resize destination');
        (evidence.gestures as Record<string, unknown>).resize = { start: resizeStart, end: resizeEnd };
        await mouseDragInFrame(page, scale, resizeStart, resizeEnd);
        const resized = noteById(await exportProject(frame, page), drawn.id);
        evidence.resized = resized;
        expect(resized.pitch).toBe(moved.pitch);
        expect(resized.startBeat).toBe(moved.startBeat);
        expect(resized.duration).toBe(moved.duration + GRID_SNAP);

        if (expressionVisible) {
            await expressionToggle.click();
            await expect(expressionLane).toHaveCount(0);
        }
    } finally {
        await testInfo.attach(`piano-roll-${condition}`, {
            body: JSON.stringify(evidence, null, 2),
            contentType: 'application/json',
        });
    }
}

for (const scale of [0.5, 1, 1.25, 2]) {
    test(`piano-roll dock retains a rendered 70px note viewport and real MIDI edits at ${scale} UI scale`, async ({
        page,
    }, testInfo) => {
        test.setTimeout(240_000);
        await page.setViewportSize(OUTER_VIEWPORT);
        await page.addInitScript(() => {
            let owner: object | null = window;
            while (owner !== null && !Object.prototype.hasOwnProperty.call(owner, 'showSaveFilePicker')) {
                owner = Object.getPrototypeOf(owner) as object | null;
            }
            if (owner !== null && !Reflect.deleteProperty(owner, 'showSaveFilePicker')) {
                throw new Error('Unable to remove showSaveFilePicker for anchor-download E2E coverage');
            }
            if ('showSaveFilePicker' in window) {
                throw new Error('showSaveFilePicker remains present after test setup');
            }
        });

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
        await page.goto('/');

        const frame = await findApplicationFrame(page);
        await expect(frame.getByLabel('Sourdaw — start a project')).toBeVisible({
            timeout: LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS,
        });
        await frame.locator('#launch-new-project').click();
        await expect(frame.getByRole('group', { name: 'Playback controls' })).toBeVisible({ timeout: 30_000 });
        await setDisplayScale(frame, scale);
        await openPianoRoll(page, frame, scale, testInfo);

        await assertCondition(page, frame, scale, false, testInfo, 'default-expression-hidden');
        await assertCondition(page, frame, scale, true, testInfo, 'default-expression-visible');
        await expect.poll(async () => (await pianoRollGeometry(frame)).dockHeight).toBe(360);

        await dragDockToMinimum(page, frame, scale);
        await assertCondition(page, frame, scale, false, testInfo, 'minimum-expression-hidden');
        await assertCondition(page, frame, scale, true, testInfo, 'minimum-expression-visible');
    });
}
