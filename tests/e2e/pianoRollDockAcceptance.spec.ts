import { readFile } from 'node:fs/promises';

import { expect, test, type Frame, type Locator, type Page, type TestInfo } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { LAUNCH_SCREEN_FIRST_PAINT_TIMEOUT_MS } from './e2eUtils';

const OUTER_VIEWPORT = { width: 1150, height: 1264 };
const RULER_HEIGHT = 22;
const ROW_HEIGHT = 16;
const BEAT_WIDTH = 40;
const GRID_SNAP = 1;
const MIN_USABLE_VIEWPORT_HEIGHT = RULER_HEIGHT + 3 * ROW_HEIGHT;
const COMPACT_TRANSPORT_MAX_WIDTH = 1199;
const CONTROL_VISIBILITY_TOLERANCE = 0.5;
const TOOLBAR_CONTROLS = [
    '1',
    '1/2',
    '1/4',
    '1/8',
    'Scale root note',
    'Scale type',
    'Toggle fold to scale',
    'Constrain notes to scale',
    'Toggle step input mode',
    'Toggle ghost notes',
    'Toggle note hover preview',
    'Toggle chord stamp mode',
    'Toggle paint mode',
    'Toggle magic lasso selection',
    'Toggle Expression View (I4)',
    'Piano roll zoom',
] as const;

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
type ToolbarControl = { name: string; rect: Rect };
type ToolbarState = {
    activeName: string | null;
    controls: ToolbarControl[];
    gridScrollLeft: number;
    rootScrollLeft: number;
    toolbarScrollLeft: number;
    toolbarScrollWidth: number;
    toolbarClientWidth: number;
    visibleViewport: Rect;
};
type AutomationTrayState = { selector: Rect; tray: Rect; visibleTray: Rect };
type NativeSelectKeyObservation = {
    key: string;
    defaultPrevented: boolean;
    selectRetainedFocus: boolean;
};
const CLOSED_NATIVE_SELECT_KEYS = ['Home', 'End', 'Space', 'ArrowDown', 'Enter'] as const;
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

async function toolbarState(frame: Frame): Promise<ToolbarState> {
    return frame.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Piano roll editor"]');
        if (canvas === null) {
            throw new Error('Piano roll canvas is unavailable for toolbar state');
        }
        let grid: HTMLElement | null = canvas.parentElement;
        while (grid !== null && window.getComputedStyle(grid).overflowY !== 'auto') {
            grid = grid.parentElement;
        }
        if (grid === null) {
            throw new Error('Piano roll grid scroll viewport is unavailable');
        }
        let root: HTMLElement | null = canvas.parentElement;
        let toolbarViewport: HTMLElement | null = null;
        while (root !== null) {
            const candidate = Array.from(root.children).find((child) =>
                child.querySelector(':scope > .daw-control-strip')
            );
            toolbarViewport = candidate instanceof HTMLElement ? candidate : null;
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
        const copy = (rect: DOMRect): Rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        const intersect = (first: Rect, second: Rect): Rect => {
            const left = Math.max(first.x, second.x);
            const top = Math.max(first.y, second.y);
            const right = Math.min(first.x + first.width, second.x + second.width);
            const bottom = Math.min(first.y + first.height, second.y + second.height);
            return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
        };
        let visibleViewport = copy(toolbarViewport.getBoundingClientRect());
        for (let ancestor = toolbarViewport.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
            const style = window.getComputedStyle(ancestor);
            if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
                visibleViewport = intersect(visibleViewport, copy(ancestor.getBoundingClientRect()));
            }
        }
        const nameOf = (element: HTMLElement): string =>
            element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName;
        const active = document.activeElement;
        return {
            activeName: active instanceof HTMLElement ? nameOf(active) : null,
            controls: Array.from(toolbar.querySelectorAll<HTMLElement>('button, select, [role="slider"]')).map(
                (control) => ({ name: nameOf(control), rect: copy(control.getBoundingClientRect()) })
            ),
            gridScrollLeft: grid.scrollLeft,
            rootScrollLeft: root.scrollLeft,
            toolbarScrollLeft: toolbarViewport.scrollLeft,
            toolbarScrollWidth: toolbarViewport.scrollWidth,
            toolbarClientWidth: toolbarViewport.clientWidth,
            visibleViewport,
        };
    });
}

function isFullyVisible(inner: Rect, outer: Rect): boolean {
    return (
        inner.x >= outer.x - CONTROL_VISIBILITY_TOLERANCE &&
        inner.y >= outer.y - CONTROL_VISIBILITY_TOLERANCE &&
        inner.x + inner.width <= outer.x + outer.width + CONTROL_VISIBILITY_TOLERANCE &&
        inner.y + inner.height <= outer.y + outer.height + CONTROL_VISIBILITY_TOLERANCE
    );
}

function expectedToolbarControls(expressionVisible: boolean): string[] {
    const zoom = requireValue(TOOLBAR_CONTROLS.at(-1), 'Piano roll Zoom control');
    return [...TOOLBAR_CONTROLS.slice(0, -1), ...(expressionVisible ? ['Active expression lane'] : []), zoom];
}

function assertToolbarFocus(state: ToolbarState, expectedName: string): void {
    expect(state.activeName).toBe(expectedName);
    const control = requireValue(
        state.controls.find((candidate) => candidate.name === expectedName),
        expectedName
    );
    expect(isFullyVisible(control.rect, state.visibleViewport)).toBe(true);
    expect(state.rootScrollLeft).toBe(0);
    expect(state.gridScrollLeft).toBe(0);
}

async function pressFromActiveControl(frame: Frame, key: string): Promise<void> {
    const active = frame.locator(':focus');
    await expect(active).toHaveCount(1);
    await active.press(key);
}

async function assertToolbarKeyboardTraversal(
    page: Page,
    frame: Frame,
    scale: number,
    expressionVisible: boolean
): Promise<void> {
    let state = await toolbarState(frame);
    if (state.toolbarScrollLeft > 0) {
        await mouseWheelInFrame(
            page,
            scale,
            {
                x: state.visibleViewport.x + state.visibleViewport.width / 2,
                y: state.visibleViewport.y + state.visibleViewport.height / 2,
            },
            -2_000,
            0
        );
        await expect.poll(async () => (await toolbarState(frame)).toolbarScrollLeft).toBe(0);
        state = await toolbarState(frame);
    }
    const expected = expectedToolbarControls(expressionVisible);
    for (const name of expected) {
        expect(state.controls.map((control) => control.name)).toContain(name);
    }
    expect(state.rootScrollLeft).toBe(0);
    expect(state.gridScrollLeft).toBe(0);

    const anchor = frame.getByRole('button', { name: 'Toggle automation lane' });
    await anchor.focus();
    await expect(anchor).toBeFocused();
    for (const name of expected) {
        await pressFromActiveControl(frame, 'Tab');
        state = await toolbarState(frame);
        assertToolbarFocus(state, name);
    }

    if (state.toolbarScrollWidth > state.toolbarClientWidth) {
        expect(state.toolbarScrollLeft).toBeGreaterThan(0);
        await mouseWheelInFrame(
            page,
            scale,
            {
                x: state.visibleViewport.x + state.visibleViewport.width / 2,
                y: state.visibleViewport.y + state.visibleViewport.height / 2,
            },
            -2_000,
            0
        );
        await expect.poll(async () => (await toolbarState(frame)).toolbarScrollLeft).toBe(0);
        state = await toolbarState(frame);
        const firstControl = requireValue(
            state.controls.find((control) => control.name === expected[0]),
            'Snap control'
        );
        expect(isFullyVisible(firstControl.rect, state.visibleViewport)).toBe(true);
        expect(state.rootScrollLeft).toBe(0);
        expect(state.gridScrollLeft).toBe(0);
    }

    for (const name of expected.slice(0, -1).reverse()) {
        await pressFromActiveControl(frame, 'Shift+Tab');
        state = await toolbarState(frame);
        assertToolbarFocus(state, name);
    }
    await pressFromActiveControl(frame, 'Shift+Tab');
    await expect(anchor).toBeFocused();
    state = await toolbarState(frame);
    expect(state.rootScrollLeft).toBe(0);
    expect(state.gridScrollLeft).toBe(0);

    const snap = frame.getByRole('button', { name: '1', exact: true });
    await snap.click();
    await expect(snap).toHaveAttribute('aria-pressed', 'true');
}

async function automationTrayState(frame: Frame): Promise<AutomationTrayState> {
    return frame.evaluate(() => {
        const tray = document.querySelector<HTMLElement>('[data-testid="clip-editor-tray"]');
        const selector = document.querySelector<HTMLElement>('#lane-selector');
        if (tray === null || selector === null) {
            throw new Error('Automation tray or lane selector is unavailable');
        }
        const copy = (rect: DOMRect): Rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        const intersect = (first: Rect, second: Rect): Rect => {
            const left = Math.max(first.x, second.x);
            const top = Math.max(first.y, second.y);
            const right = Math.min(first.x + first.width, second.x + second.width);
            const bottom = Math.min(first.y + first.height, second.y + second.height);
            return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
        };
        let visibleTray = copy(tray.getBoundingClientRect());
        for (let ancestor = tray.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
            const style = window.getComputedStyle(ancestor);
            if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
                visibleTray = intersect(visibleTray, copy(ancestor.getBoundingClientRect()));
            }
        }
        return {
            selector: copy(selector.getBoundingClientRect()),
            tray: copy(tray.getBoundingClientRect()),
            visibleTray,
        };
    });
}

async function isClipEditorScrollStop(frame: Frame): Promise<boolean> {
    return frame.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Piano roll editor"]');
        const active = document.activeElement;
        if (canvas === null || !(active instanceof HTMLElement) || active === canvas) {
            return false;
        }
        const style = window.getComputedStyle(active);
        if (!/(auto|scroll)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
            return false;
        }
        // Chromium admits the expression lane's horizontal scrollport to the
        // native Tab order. The grid scrollport contains the piano-roll canvas;
        // the expression stop contains its rendered lane group. No other
        // application scrollport is accepted as part of this editor traversal.
        return active.contains(canvas) || active.querySelector('[role="group"][aria-label$=" lane"]') !== null;
    });
}

async function workspaceMode(frame: Frame): Promise<string | null> {
    return frame.evaluate(async () => {
        const { workspaceStore } = await import('/src/modules/WorkspaceShell/stores/workspaceStore.ts');
        return workspaceStore.value?.mode ?? null;
    });
}

async function pressBetweenPianoRollAndTray(frame: Frame, key: 'Tab' | 'Shift+Tab', expected: Locator): Promise<void> {
    await pressFromActiveControl(frame, key);
    if (await expected.evaluate((element) => document.activeElement === element)) {
        return;
    }
    expect(await isClipEditorScrollStop(frame)).toBe(true);
    await pressFromActiveControl(frame, key);
    await expect(expected).toBeFocused();
}

async function observeNativeSelectKey(frame: Frame, key: string): Promise<NativeSelectKeyObservation> {
    await frame.evaluate(() => {
        const selector = document.querySelector<HTMLSelectElement>('#lane-selector');
        if (selector === null) {
            throw new Error('Automation lane selector is unavailable');
        }
        const element = selector as HTMLSelectElement & {
            __pianoRollNativeKeyCapture?: {
                observations: NativeSelectKeyObservation[];
                listener: (event: KeyboardEvent) => void;
            };
        };
        const observations: NativeSelectKeyObservation[] = [];
        const listener = (event: KeyboardEvent) => {
            window.setTimeout(() => {
                observations.push({
                    key: event.key,
                    defaultPrevented: event.defaultPrevented,
                    selectRetainedFocus: document.activeElement === selector,
                });
            }, 0);
        };
        element.__pianoRollNativeKeyCapture = { observations, listener };
        selector.addEventListener('keydown', listener);
    });

    await pressFromActiveControl(frame, key);

    return frame.evaluate(async () => {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        const selector = document.querySelector<HTMLSelectElement>('#lane-selector');
        if (selector === null) {
            throw new Error('Automation lane selector is unavailable');
        }
        const element = selector as HTMLSelectElement & {
            __pianoRollNativeKeyCapture?: {
                observations: NativeSelectKeyObservation[];
                listener: (event: KeyboardEvent) => void;
            };
        };
        const capture = element.__pianoRollNativeKeyCapture;
        if (capture === undefined) {
            throw new Error('Native select key capture is unavailable');
        }
        selector.removeEventListener('keydown', capture.listener);
        delete element.__pianoRollNativeKeyCapture;
        const observation = capture.observations.at(0);
        if (observation === undefined) {
            throw new Error('Native select key was not delivered to the closed selector');
        }
        return observation;
    });
}

async function nativeSelectIsOpen(selector: Locator): Promise<boolean> {
    return selector.evaluate((element) => {
        if (!CSS.supports('selector(select:open)')) {
            throw new Error('Browser does not expose native select open state');
        }
        return element.matches(':open');
    });
}

async function automationTrayHeaderNeutralPoint(frame: Frame): Promise<{ x: number; y: number }> {
    return frame.evaluate((tolerance) => {
        const selector = document.querySelector<HTMLElement>('#lane-selector');
        if (selector === null) {
            throw new Error('Automation tray selector is unavailable');
        }
        const header = selector.parentElement;
        if (header === null) {
            throw new Error('Automation tray header is unavailable');
        }
        const label = header.querySelector('label[for="lane-selector"]');
        if (label === null) {
            throw new Error('Automation tray header label is unavailable');
        }
        const headerRect = header.getBoundingClientRect();
        const selectorRect = selector.getBoundingClientRect();
        const rightGap = headerRect.right - selectorRect.right;
        if (rightGap <= tolerance * 2) {
            throw new Error('Automation tray header has no neutral background beside the selector');
        }
        const point = { x: selectorRect.right + rightGap / 2, y: headerRect.y + headerRect.height / 2 };
        if (
            point.x < 0 ||
            point.y < 0 ||
            point.x > window.innerWidth ||
            point.y > window.innerHeight ||
            document.elementFromPoint(point.x, point.y) !== header
        ) {
            throw new Error('Automation tray neutral background is not safely clickable');
        }
        return point;
    }, CONTROL_VISIBILITY_TOLERANCE);
}

async function resetNativeSelectToClosed(
    page: Page,
    frame: Frame,
    scale: number,
    selector: Locator,
    playhead: Locator,
    expectedPlayhead: string,
    expectedWorkspaceMode: string | null
): Promise<void> {
    await pressFromActiveControl(frame, 'Escape');
    const neutralPoint = await automationTrayHeaderNeutralPoint(frame);
    // Escape alone does not close every browser's native popup. A click on this
    // non-interactive header background supplies the browser's blur boundary.
    await mouseClickInFrame(page, scale, neutralPoint);
    await expect.poll(() => nativeSelectIsOpen(selector)).toBe(false);
    await selector.focus();
    await expect(selector).toBeFocused();
    await expect.poll(() => nativeSelectIsOpen(selector)).toBe(false);
    await expect(playhead).toHaveText(expectedPlayhead);
    await expect.poll(() => workspaceMode(frame)).toBe(expectedWorkspaceMode);
}

async function assertAutomationLaneValueChange(frame: Frame, selector: Locator): Promise<void> {
    const currentValue = await selector.inputValue();
    const enabledValues = await selector.locator('option').evaluateAll((options) =>
        options.flatMap((option) => {
            const candidate = option as HTMLOptionElement;
            return candidate.disabled ? [] : [candidate.value];
        })
    );
    expect(enabledValues).toContain(currentValue);
    expect(enabledValues).toEqual(expect.arrayContaining(['velocity', 'probability']));
    const nextValue = currentValue === 'velocity' ? 'probability' : 'velocity';
    expect(nextValue).not.toBe(currentValue);
    await selector.selectOption(nextValue);
    await expect(selector).toHaveValue(nextValue);
    const laneLabel = nextValue === 'velocity' ? 'Velocity' : 'Probability';
    await expect(frame.getByTestId('clip-editor-tray').getByRole('group', { name: `${laneLabel} lane` })).toBeVisible();
}

async function assertAutomationTray(page: Page, frame: Frame, scale: number): Promise<void> {
    const toggle = frame.getByRole('button', { name: 'Toggle automation lane' });
    const selector = frame.getByRole('combobox', { name: 'Automation lane type' });
    const pianoRoll = frame.getByLabel('Piano roll editor');
    const playhead = frame.getByTestId('transport-playhead');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(selector).toBeVisible();
    const state = await automationTrayState(frame);
    expect(state.visibleTray.width).toBeGreaterThan(CONTROL_VISIBILITY_TOLERANCE);
    expect(state.visibleTray.height).toBeGreaterThan(CONTROL_VISIBILITY_TOLERANCE);
    expect(isFullyVisible(state.selector, state.visibleTray)).toBe(true);

    await expect(pianoRoll).toHaveAttribute('tabindex', '0');
    await expect(pianoRoll).toHaveAttribute('data-canvas-editor', '');
    await frame.locator('body').press('Home');
    await expect(playhead).toContainText('1.1.000');
    const playheadAtStart = await playhead.textContent();
    await frame.locator('body').press('End');
    await expect(playhead).not.toHaveText(requireValue(playheadAtStart, 'Initial playhead text'));
    const playheadAtClipEnd = requireValue(await playhead.textContent(), 'Clip-end playhead text');

    await pianoRoll.focus();
    await expect(pianoRoll).toBeFocused();
    const initialWorkspaceMode = await workspaceMode(frame);
    await pressBetweenPianoRollAndTray(frame, 'Tab', selector);
    await expect(selector).toBeFocused();
    await expect.poll(() => workspaceMode(frame)).toBe(initialWorkspaceMode);
    const nativeKeyObservations: NativeSelectKeyObservation[] = [];
    for (const nativeKey of CLOSED_NATIVE_SELECT_KEYS) {
        await expect.poll(() => nativeSelectIsOpen(selector)).toBe(false);
        await expect(selector).toBeFocused();
        const observation = await observeNativeSelectKey(frame, nativeKey);
        expect(observation.selectRetainedFocus).toBe(true);
        nativeKeyObservations.push(observation);
        await resetNativeSelectToClosed(
            page,
            frame,
            scale,
            selector,
            playhead,
            playheadAtClipEnd,
            initialWorkspaceMode
        );
    }
    expect(nativeKeyObservations).toEqual([
        { key: 'Home', defaultPrevented: false, selectRetainedFocus: true },
        { key: 'End', defaultPrevented: false, selectRetainedFocus: true },
        { key: ' ', defaultPrevented: false, selectRetainedFocus: true },
        { key: 'ArrowDown', defaultPrevented: false, selectRetainedFocus: true },
        { key: 'Enter', defaultPrevented: false, selectRetainedFocus: true },
    ]);
    await expect(playhead).toHaveText(playheadAtClipEnd);
    await assertAutomationLaneValueChange(frame, selector);
    await pressBetweenPianoRollAndTray(frame, 'Shift+Tab', pianoRoll);
    await expect(pianoRoll).toBeFocused();
    await expect.poll(() => workspaceMode(frame)).toBe(initialWorkspaceMode);
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

async function openPianoRoll(page: Page, frame: Frame, scale: number): Promise<void> {
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
    const beforePaint = await toolbarState(frame);
    const paintControl = requireValue(
        beforePaint.controls.find((control) => control.name === 'Toggle paint mode'),
        'Paint control before activation'
    );
    const paintStartsOutsideToolbarViewport =
        paintControl.rect.x < beforePaint.visibleViewport.x ||
        paintControl.rect.x + paintControl.rect.width >
            beforePaint.visibleViewport.x + beforePaint.visibleViewport.width;
    await frame.getByRole('button', { name: 'Toggle paint mode' }).click();
    const afterPaint = await toolbarState(frame);
    expect(beforePaint.rootScrollLeft).toBe(0);
    expect(afterPaint.rootScrollLeft).toBe(0);
    if (paintStartsOutsideToolbarViewport) {
        expect(afterPaint.toolbarScrollLeft).toBeGreaterThan(0);
    } else {
        expect(afterPaint.toolbarScrollLeft).toBe(0);
    }
    expect((await pianoRollGeometry(frame)).scrollLeft).toBe(0);
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

        await assertAutomationTray(page, frame, scale);
        await assertToolbarKeyboardTraversal(page, frame, scale, expressionVisible);

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
        await openPianoRoll(page, frame, scale);

        await assertCondition(page, frame, scale, false, testInfo, 'default-expression-hidden');
        await assertCondition(page, frame, scale, true, testInfo, 'default-expression-visible');
        await expect.poll(async () => (await pianoRollGeometry(frame)).dockHeight).toBe(360);

        await dragDockToMinimum(page, frame, scale);
        await assertCondition(page, frame, scale, false, testInfo, 'minimum-expression-hidden');
        await assertCondition(page, frame, scale, true, testInfo, 'minimum-expression-visible');
    });
}
