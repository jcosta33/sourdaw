import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium, devices, type Locator, type Page, type TestInfo } from '@playwright/test';
import { stringify as superjsonStringify } from 'superjson';

import { expect, test } from './e2eTest';
import {
    wait_for_launch_first_paint,
    launch_new_project,
    PREFERENCES_STORAGE_KEY,
    setupWorkspace,
    wait_for_workspace_ready,
} from './e2eUtils';
import { attach_first_paint_console } from './firstPaintDiagnostics';

const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const OFFLINE_IDLE_WINDOW_MS = 500;
const MAX_SCHEDULED_OSCILLATOR_LEAD_SECONDS = 0.1;
const MANUAL_SAVE_PREFERENCES = superjsonStringify({ autoSave: false });
const CRDT_MODULE_DOCUMENT = '/src/modules/CrdtDocument/models/CrdtRootLineage.ts';
const CRDT_DATABASE_NAME = 'sourdaw-crdt-docs';
// Restated from src: Project/repositories/project/storageSupport.ts (DB_NAME/STORE_NAME),
// Project/models/ProjectData.ts (RECENT_PROJECTS_KEY) and the private binding schema in
// Project/repositories/project/projectDirectoryBinding.ts.
const PROJECT_DATABASE_NAME = 'sourdaw-projects';
const PROJECT_STORE_NAME = 'projects';
const RECENT_PROJECTS_KEY = 'sourdaw-recent-projects';
const DIRECTORY_BINDING_DATABASE_NAME = 'sourdaw-project-directory-bindings';
const DIRECTORY_BINDING_STORE_NAME = 'directories';

test.use({ serviceWorkers: 'block' });

function dirtyIndicator(page: Page) {
    return page.getByTitle('Unsaved changes');
}

function trackList(page: Page) {
    return page.getByRole('grid', { name: /Track list/i }).first();
}

function isLoopbackEndpoint(url: URL): boolean {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

async function blockExternalRequests(page: Page): Promise<() => Promise<void>> {
    const unexpectedEndpoints = { requests: [] as string[], webSockets: [] as string[] };
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (isLoopbackEndpoint(url)) {
            await route.continue();
            return;
        }
        unexpectedEndpoints.requests.push(url.toString());
        await route.abort('blockedbyclient');
    });
    await page.routeWebSocket('**/*', async (webSocket) => {
        const url = new URL(webSocket.url());
        if (isLoopbackEndpoint(url)) {
            webSocket.connectToServer();
            return;
        }
        unexpectedEndpoints.webSockets.push(url.toString());
        await webSocket.close({ code: 1008, reason: 'External network blocked' });
    });
    return async () => {
        await page.waitForTimeout(OFFLINE_IDLE_WINDOW_MS);
        expect(unexpectedEndpoints, 'offline smoke blocked external runtime endpoints').toEqual({
            requests: [],
            webSockets: [],
        });
    };
}

type AudioContextTestControl = {
    graphState: () => Promise<string>;
    suspend: () => Promise<string | undefined>;
    count: () => Promise<number>;
    lead: () => Promise<number>;
    reset: () => Promise<void>;
    hasContextMismatch: () => Promise<boolean>;
};

async function observeAudioContext(page: Page): Promise<AudioContextTestControl> {
    await page.addInitScript(() => {
        // Resolved per call, never captured: an init script runs before the
        // parser has produced `<html>`, so `document.documentElement` is still
        // null here and only exists by the time the app builds an audio graph.
        const root = () => document.documentElement;
        const nativeCreateGain = AudioContext.prototype.createGain;
        const nativeResume = AudioContext.prototype.resume;
        const nativeStart = OscillatorNode.prototype.start;
        let graphContext: AudioContext | undefined;

        const reportContextMismatch = () => {
            root().dataset.audioContextMismatch = 'true';
        };
        const captureGraphContext = (context: AudioContext) => {
            if (!graphContext) {
                graphContext = context;
                return;
            }
            if (graphContext !== context) {
                reportContextMismatch();
            }
        };

        AudioContext.prototype.createGain = function (this: AudioContext): GainNode {
            const gain = nativeCreateGain.call(this);
            captureGraphContext(this);
            return gain;
        };
        AudioContext.prototype.resume = async function (this: AudioContext): Promise<void> {
            if (graphContext !== this) {
                reportContextMismatch();
            }
            await nativeResume.call(this);
            root().dataset.audioContextGraphState = graphContext?.state ?? 'missing';
        };
        OscillatorNode.prototype.start = function (
            this: OscillatorNode,
            ...args: Parameters<OscillatorNode['start']>
        ): void {
            nativeStart.apply(this, args);
            if (graphContext !== this.context) {
                reportContextMismatch();
                return;
            }
            const currentTime = this.context.currentTime;
            const scheduledTime = args[0] ?? currentTime;
            const lead = scheduledTime - currentTime;
            const count = Number(root().dataset.scheduledOscillatorCount ?? '0');
            root().dataset.scheduledOscillatorCount = String(count + 1);
            root().dataset.scheduledOscillatorLead = String(lead);
        };
        document.addEventListener('sourdaw-test-reset-scheduled-oscillator-count', () => {
            root().dataset.scheduledOscillatorCount = '0';
            delete root().dataset.scheduledOscillatorLead;
        });
        document.addEventListener('sourdaw-test-read-audio-context-state', () => {
            root().dataset.audioContextGraphState = graphContext?.state ?? 'missing';
            document.dispatchEvent(new Event('sourdaw-test-audio-context-state-read'));
        });
        document.addEventListener('sourdaw-test-suspend-audio-context', () => {
            void (async () => {
                if (!graphContext) {
                    root().dataset.audioContextGraphState = 'missing';
                } else {
                    await graphContext.suspend();
                    root().dataset.audioContextGraphState = graphContext.state;
                }
                document.dispatchEvent(new Event('sourdaw-test-audio-context-suspended'));
            })();
        });
    });
    return {
        graphState: () =>
            page.evaluate(
                () =>
                    new Promise<string>((resolve) => {
                        document.addEventListener(
                            'sourdaw-test-audio-context-state-read',
                            () => resolve(document.documentElement.dataset.audioContextGraphState ?? 'missing'),
                            { once: true }
                        );
                        document.dispatchEvent(new Event('sourdaw-test-read-audio-context-state'));
                    })
            ),
        suspend: () =>
            page.evaluate(
                () =>
                    new Promise<string | undefined>((resolve) => {
                        document.addEventListener(
                            'sourdaw-test-audio-context-suspended',
                            () => resolve(document.documentElement.dataset.audioContextGraphState),
                            { once: true }
                        );
                        document.dispatchEvent(new Event('sourdaw-test-suspend-audio-context'));
                    })
            ),
        count: async () =>
            Number(await page.evaluate(() => document.documentElement.dataset.scheduledOscillatorCount ?? '0')),
        lead: async () =>
            Number(await page.evaluate(() => document.documentElement.dataset.scheduledOscillatorLead ?? 'NaN')),
        reset: () =>
            page.evaluate(() => {
                document.dispatchEvent(new Event('sourdaw-test-reset-scheduled-oscillator-count'));
            }),
        hasContextMismatch: async () =>
            (await page.evaluate(() => document.documentElement.dataset.audioContextMismatch)) === 'true',
    };
}

async function openNewProject(page: Page): Promise<() => Promise<void>> {
    const assertOffline = await blockExternalRequests(page);
    await setupWorkspace(page, {
        localStorage: [{ name: PREFERENCES_STORAGE_KEY, value: MANUAL_SAVE_PREFERENCES }],
    });
    await launch_new_project(page);
    return assertOffline;
}

async function addMidiTrack(page: Page): Promise<void> {
    const list = trackList(page);
    const before = await list.getByRole('row').count();
    await page.keyboard.press(`${MODIFIER}+k`);
    await page.getByPlaceholder('Type a command...', { exact: true }).fill('Add MIDI Track');
    await page.getByRole('option', { name: 'Add MIDI Track' }).click();
    await expect.poll(() => list.getByRole('row').count()).toBeGreaterThan(before);
    await list.getByText('MIDI 1', { exact: true }).click();
}

async function midiLaneY(page: Page): Promise<number> {
    const timeline = page.getByLabel('Timeline editor surface');
    const muteBox = await page.getByRole('button', { name: 'Mute MIDI' }).boundingBox();
    const timelineBox = await timeline.boundingBox();
    if (!muteBox || !timelineBox) {
        throw new Error('Mute MIDI or timeline surface has no bounding box');
    }
    return Math.min(Math.max(muteBox.y - timelineBox.y + muteBox.height / 2, 8), timelineBox.height - 8);
}

async function openBottomTab(page: Page, name: string): Promise<void> {
    const dock = page.getByRole('button', { name: 'Toggle bottom dock' });
    if ((await dock.getAttribute('aria-pressed')) !== 'true') {
        await dock.click();
    }
    const tab = page.getByRole('tablist', { name: 'Bottom dock' }).getByRole('tab', { name, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
}

async function createPlayableMidiClip(page: Page): Promise<Locator> {
    await addMidiTrack(page);
    const timeline = page.getByLabel('Timeline editor surface');
    await expect(timeline).toBeVisible();
    const y = await midiLaneY(page);
    await timeline.click({ button: 'right', position: { x: 30, y } });
    await page.getByRole('menuitem', { name: /Add Clip Here/i }).click();
    await expect(page.getByText(/New midi clip/i).first()).toBeVisible();
    await timeline.dblclick({ position: { x: 30, y } });
    const pianoRoll = page.getByLabel('Piano roll editor');
    await expect(pianoRoll).toBeVisible();
    await openBottomTab(page, 'Editor');

    const paint = page.getByRole('button', { name: 'Toggle paint mode' });
    if ((await paint.getAttribute('aria-pressed')) !== 'true') {
        await paint.click();
    }
    await pianoRoll.click({ position: { x: 40, y: 130 } });
    await expect(page.getByTestId('selected-clip-note-count')).toHaveText('1 note');
    return pianoRoll;
}

async function renameProject(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: 'Untitled Project' }).click();
    const projectNameInput = page.locator('input:focus');
    await projectNameInput.fill(name);
    await projectNameInput.press('Enter');
}

async function startBlankProject(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Project menu', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New Project', exact: true }).click();
    await expect(page.getByTestId('project-name')).toHaveText('Untitled Project');
    await expect(page.getByText('Add your first track')).toBeVisible();
    await expect(page.getByRole('grid', { name: /Track list/i })).toHaveCount(0);
}

async function withExternalProjectPage(
    testInfo: TestInfo,
    baseURL: string | undefined,
    run: (page: Page, folderPath: string) => Promise<void>
): Promise<void> {
    if (typeof baseURL !== 'string') {
        throw new TypeError('The offline smoke project has no application origin');
    }
    const folderPath = testInfo.outputPath('external-project-root');
    await mkdir(folderPath, { recursive: true });
    const context = await chromium.launchPersistentContext(testInfo.outputPath('external-browser-profile'), {
        ...devices['Desktop Chrome'],
        baseURL,
        headless: true,
        serviceWorkers: 'block',
        // Grants the dropped external directory in this disposable profile;
        // this does not exercise Chrome's normal folder-permission prompt.
        args: ['--enable-experimental-web-platform-features'],
    });
    try {
        const page = context.pages()[0] ?? (await context.newPage());
        await run(page, folderPath);
    } finally {
        await context.close();
    }
}

async function useExternalProjectFolder(page: Page, folderPath: string): Promise<void> {
    await page.evaluate(() => {
        const target = document.createElement('div');
        target.id = 'external-project-folder-drop';
        target.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:white';
        target.dataset.status = 'waiting';
        let selectedHandle: FileSystemHandle | null = null;
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: () => {
                if (!selectedHandle || selectedHandle.kind !== 'directory') {
                    throw new Error('No external project folder was selected');
                }
                return Promise.resolve(selectedHandle);
            },
        });
        target.addEventListener('dragover', (event) => event.preventDefault());
        target.addEventListener('drop', (event) => {
            event.preventDefault();
            const canGetFileSystemHandle = (
                candidate: DataTransferItem
            ): candidate is DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle | null> } =>
                'getAsFileSystemHandle' in candidate && typeof candidate.getAsFileSystemHandle === 'function';
            const item = Array.from(event.dataTransfer?.items ?? []).find((candidate) => candidate.kind === 'file');
            if (!item || !canGetFileSystemHandle(item)) {
                target.dataset.status = 'missing-dropped-directory';
                return;
            }
            void (async () => {
                try {
                    const handle = await item.getAsFileSystemHandle();
                    if (!handle || handle.kind !== 'directory') {
                        target.dataset.status = 'not-a-directory';
                        return;
                    }
                    target.dataset.readPermission = await handle.queryPermission({ mode: 'read' });
                    target.dataset.writePermission = await handle.queryPermission({ mode: 'readwrite' });
                    selectedHandle = handle;
                    target.dataset.status = 'captured';
                } catch {
                    target.dataset.status = 'directory-handle-rejected';
                }
            })();
        });
        document.body.append(target);
    });
    const cdp = await page.context().newCDPSession(page);
    const data = { items: [], files: [folderPath], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
        await cdp.send('Input.dispatchDragEvent', { type, x: 80, y: 80, data });
    }
    await page.waitForFunction(() => {
        const status = document.getElementById('external-project-folder-drop')?.dataset.status;
        return status !== undefined && status !== 'waiting';
    });
    const status = await page.locator('#external-project-folder-drop').getAttribute('data-status');
    expect(status).toBe('captured');
    expect(await page.locator('#external-project-folder-drop').getAttribute('data-read-permission')).toBe('granted');
    const permission = await page.evaluate(async () => {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const read = await handle.queryPermission({ mode: 'read' });
        const beforeWrite = await handle.queryPermission({ mode: 'readwrite' });
        const requestedWrite =
            beforeWrite === 'granted' ? beforeWrite : await handle.requestPermission({ mode: 'readwrite' });
        const afterWrite = await handle.queryPermission({ mode: 'readwrite' });
        return { read, requestedWrite, afterWrite };
    });
    expect(permission).toEqual({ read: 'granted', requestedWrite: 'granted', afterWrite: 'granted' });
    await page.locator('#external-project-folder-drop').evaluate((target) => target.remove());
}

async function expectCommittedProjectFolder(page: Page, folderPath: string): Promise<void> {
    const committed = await page.evaluate(async () => {
        const root = await window.showDirectoryPicker({ mode: 'readwrite' });
        const projects = await root.getDirectoryHandle('projects');
        const folders: FileSystemDirectoryHandle[] = [];
        for await (const handle of projects.values()) {
            if (handle.kind === 'directory') {
                folders.push(handle);
            }
        }
        if (folders.length !== 1) {
            throw new Error('Expected one saved project folder');
        }
        const folder = folders[0];
        if (!folder) {
            throw new Error('The saved project folder is unavailable');
        }
        const manifestFile = await (await folder.getFileHandle('manifest.json')).getFile();
        const manifestText = await manifestFile.text();
        const manifest: unknown = JSON.parse(manifestText);
        if (
            typeof manifest !== 'object' ||
            manifest === null ||
            !('document' in manifest) ||
            typeof manifest.document !== 'object' ||
            manifest.document === null ||
            !('path' in manifest.document) ||
            typeof manifest.document.path !== 'string' ||
            !('sha256' in manifest.document) ||
            typeof manifest.document.sha256 !== 'string' ||
            !('format' in manifest)
        ) {
            throw new Error('The project folder has no document manifest entry');
        }
        const document = await (await folder.getFileHandle(manifest.document.path)).getFile();
        return {
            projectId: folder.name,
            format: manifest.format,
            documentBytes: document.size,
            documentPath: manifest.document.path,
            documentHash: manifest.document.sha256,
            manifestText,
        };
    });
    expect(committed.format).toBe('sourdaw-project-directory-v1');
    expect(committed.projectId).toMatch(/^[a-f0-9-]{36}$/);
    expect(committed.documentBytes).toBeGreaterThan(0);
    expect(committed.documentPath).toMatch(/^document\.[a-f0-9]{64}\.sdaw$/);
    const hostFolder = join(folderPath, 'projects', committed.projectId);
    expect(await readFile(join(hostFolder, 'manifest.json'), 'utf8')).toBe(committed.manifestText);
    const hostDocument = await readFile(join(hostFolder, committed.documentPath));
    expect(hostDocument.byteLength).toBe(committed.documentBytes);
    expect(`sha256:${createHash('sha256').update(hostDocument).digest('hex')}`).toBe(committed.documentHash);
}

async function clearCrdtDatabase(page: Page): Promise<void> {
    await page.evaluate(async (databaseName) => {
        await new Promise<void>((resolve, reject) => {
            const request = indexedDB.deleteDatabase(databaseName);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error ?? new Error('IndexedDB delete failed'));
            request.onblocked = () => reject(new Error('IndexedDB delete was blocked'));
        });
    }, CRDT_DATABASE_NAME);
}

async function recentProjectKey(page: Page, name: string): Promise<string> {
    return page.evaluate(
        ({ name, recentProjectsKey }) => {
            // The project adapter stores the list through superjson, so the entry array is
            // `{ json: [...] }`; a raw array stays readable for completeness.
            const raw = localStorage.getItem(recentProjectsKey);
            const stored: unknown = raw === null ? null : JSON.parse(raw);
            const entries: unknown =
                typeof stored === 'object' && stored !== null && 'json' in stored ? stored.json : stored;
            if (!Array.isArray(entries)) {
                throw new Error('The recent-projects index is unreadable');
            }
            for (const entry of entries) {
                if (
                    typeof entry === 'object' &&
                    entry !== null &&
                    'name' in entry &&
                    'key' in entry &&
                    entry.name === name &&
                    typeof entry.key === 'string'
                ) {
                    return entry.key;
                }
            }
            throw new Error(`No recent project entry is named ${name}`);
        },
        { name, recentProjectsKey: RECENT_PROJECTS_KEY }
    );
}

async function deleteProjectRecord(page: Page, databaseName: string, storeName: string, key: string): Promise<void> {
    await page.evaluate(
        async ({ databaseName, storeName, key }) => {
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.open(databaseName);
                request.onerror = () => reject(request.error ?? new Error(`${databaseName} could not be opened`));
                request.onsuccess = () => {
                    const database = request.result;
                    if (!database.objectStoreNames.contains(storeName)) {
                        database.close();
                        resolve();
                        return;
                    }
                    const transaction = database.transaction(storeName, 'readwrite');
                    transaction.objectStore(storeName).delete(key);
                    transaction.oncomplete = () => {
                        database.close();
                        resolve();
                    };
                    transaction.onerror = () => reject(transaction.error ?? new Error(`Could not delete ${key}`));
                    transaction.onabort = () => reject(transaction.error ?? new Error(`Could not delete ${key}`));
                };
            });
        },
        { databaseName, storeName, key }
    );
}

/**
 * The fresh realm must reopen the project from its folder, never from the
 * named snapshot `loadRecentProject` falls back to when the handle is gone.
 * Drop both the live CRDT copy and the saved snapshot, force a normal
 * launch-screen boot (no `last` bookmark), and prove the folder's manifest and
 * document are readable before the click.
 */
async function prepareFreshRealmForFolderReopen(page: Page, appRootUrl: string, name: string): Promise<string> {
    await page.goto(new URL(CRDT_MODULE_DOCUMENT, appRootUrl).toString());
    const key = await recentProjectKey(page, name);
    await clearCrdtDatabase(page);
    await deleteProjectRecord(page, PROJECT_DATABASE_NAME, PROJECT_STORE_NAME, key);
    await deleteProjectRecord(page, DIRECTORY_BINDING_DATABASE_NAME, DIRECTORY_BINDING_STORE_NAME, 'last');
    const source = await page.evaluate(
        async ({ key }) => {
            const bindingModule = await import('/src/modules/Project/repositories/project/projectDirectoryBinding.ts');
            const binding = await bindingModule.projectDirectoryBinding.loadProjectDirectoryBinding(`recent:${key}`);
            if (!binding) {
                throw new Error('The fresh realm lost the project folder binding');
            }
            const directory = await bindingModule.projectDirectoryBinding.openProjectDirectory(
                binding.root,
                binding.projectId,
                false
            );
            const { projectDirectory } = await import('/src/modules/Project/repositories/project/projectDirectory.ts');
            const content = await projectDirectory.read(directory, binding.projectId);
            if (content.document.byteLength === 0) {
                throw new Error('The project folder holds no document');
            }
            return { projectId: binding.projectId, documentBytes: content.document.byteLength };
        },
        { key }
    );
    expect(source.documentBytes).toBeGreaterThan(0);
    return key;
}

/**
 * A handle restored from a previous session loses its permission grant; the
 * browser re-asks during the user's gesture. The persistent profile keeps the
 * grant, so downgrade the reported state to force the re-request path.
 */
async function installLostFolderGrant(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const prototype = FileSystemDirectoryHandle.prototype;
        const queryPermission = prototype.queryPermission;
        prototype.queryPermission = async function (options?: FileSystemHandlePermissionDescriptor) {
            const state = await queryPermission.call(this, options);
            return state === 'granted' ? 'prompt' : state;
        };
        prototype.requestPermission = async function () {
            const key = '__sourdawFolderGrantRequests';
            Reflect.set(window, key, Number(Reflect.get(window, key) ?? 0) + 1);
            return 'granted';
        };
    });
}

async function folderGrantRequestCount(page: Page): Promise<number> {
    return page.evaluate(() => Number(Reflect.get(window, '__sourdawFolderGrantRequests') ?? 0));
}

async function openSavedProjectInFreshPage(
    page: Page,
    name: string,
    { loseGrant = false }: { loseGrant?: boolean } = {}
) {
    const browserContext = page.context();
    const appRootUrl = new URL('/', page.url()).toString();
    await page.close();

    const realm = await browserContext.newPage();
    const assertRealmOffline = await blockExternalRequests(realm);
    try {
        await prepareFreshRealmForFolderReopen(realm, appRootUrl, name);
        await assertRealmOffline();
    } finally {
        await realm.close();
    }

    const reopenedPage = await browserContext.newPage();
    if (loseGrant) {
        await installLostFolderGrant(reopenedPage);
    }
    const assertOffline = await blockExternalRequests(reopenedPage);
    // Attached before the navigation so a first-paint timeout here — the wait
    // that red in #4781's second case — diagnoses itself from the console.
    attach_first_paint_console(reopenedPage);
    await reopenedPage.goto(appRootUrl);
    await wait_for_launch_first_paint(reopenedPage);
    const recentProject = reopenedPage.getByRole('button', { name: `Open recent project ${name}` });
    await expect(recentProject).toBeVisible();
    await recentProject.click();
    await wait_for_workspace_ready(reopenedPage);
    const projectName = reopenedPage.getByTestId('project-name');
    await expect(projectName).toHaveText(name, { timeout: 30_000 });
    if (loseGrant) {
        expect(await folderGrantRequestCount(reopenedPage)).toBeGreaterThan(0);
    }
    return { assertOffline, page: reopenedPage };
}

test.describe('Offline project smoke', () => {
    test('launches a new project into the workspace', async ({ page }) => {
        // This first offline leg pays the cold first-run application transform.
        test.setTimeout(150_000);
        const assertOffline = await openNewProject(page);

        await expect(page.getByRole('group', { name: 'Playback controls' })).toBeVisible();
        await expect(page.getByText('Add your first track')).toBeVisible();
        await assertOffline();
    });

    test('saves and reopens an edited project', async ({ baseURL }, testInfo) => {
        await withExternalProjectPage(testInfo, baseURL, async (page, folderPath) => {
            const assertOffline = await openNewProject(page);
            await useExternalProjectFolder(page, folderPath);
            await expect(dirtyIndicator(page)).toHaveCount(0);

            await renameProject(page, 'Smoke Persistence');

            await addMidiTrack(page);
            await expect(dirtyIndicator(page)).toBeVisible();

            await page.keyboard.press(`${MODIFIER}+s`);
            await expect(dirtyIndicator(page)).toHaveCount(0);
            await expectCommittedProjectFolder(page, folderPath);
            await startBlankProject(page);
            await assertOffline();

            let reopened = await openSavedProjectInFreshPage(page, 'Smoke Persistence');
            try {
                await expect(reopened.page.getByTestId('project-name')).toHaveText('Smoke Persistence');
                await expect(trackList(reopened.page).getByText('MIDI 1', { exact: true })).toBeVisible();
                await reopened.assertOffline();

                // A restored handle lapses its grant between sessions; the user's click must be
                // able to re-ask for it and still reopen the folder bytes.
                reopened = await openSavedProjectInFreshPage(reopened.page, 'Smoke Persistence', {
                    loseGrant: true,
                });
                await expect(reopened.page.getByTestId('project-name')).toHaveText('Smoke Persistence');
            } finally {
                await reopened.page.close();
            }
        });
    });

    test('advances the playhead during playback and restores it on stop', async ({ page }) => {
        const audioContext = await observeAudioContext(page);
        const assertOffline = await openNewProject(page);
        await createPlayableMidiClip(page);

        const playbackControls = page.getByRole('group', { name: 'Playback controls' });
        const playhead = page.getByTestId('transport-playhead');
        const playheadPosition = async () => (await playhead.innerText()).replaceAll(/\s/g, '');
        const initialPosition = await playheadPosition();
        const play = page.getByTestId('transport-play');
        await audioContext.reset();
        await expect.poll(audioContext.count).toBe(0);
        await expect.poll(audioContext.hasContextMismatch).toBe(false);
        await audioContext.suspend();
        await expect.poll(audioContext.graphState).toBe('suspended');
        await play.click();
        await expect(playbackControls.getByRole('status')).toHaveText('Playing');
        await expect(play).toHaveAccessibleName('Pause');
        await expect.poll(audioContext.graphState).toBe('running');
        await expect.poll(audioContext.hasContextMismatch).toBe(false);
        await expect.poll(audioContext.count).toBeGreaterThan(0);
        await expect.poll(audioContext.lead).toBeGreaterThanOrEqual(0);
        await expect.poll(audioContext.lead).toBeLessThanOrEqual(MAX_SCHEDULED_OSCILLATOR_LEAD_SECONDS);

        await expect.poll(playheadPosition).not.toBe(initialPosition);
        const firstAdvancedPosition = await playheadPosition();
        await expect.poll(playheadPosition).not.toBe(firstAdvancedPosition);

        await page.getByTestId('transport-stop').click();
        await expect(playbackControls.getByRole('status')).toHaveText('Stopped');
        await expect(play).toHaveAccessibleName('Play');
        await expect.poll(playheadPosition).toBe(initialPosition);
        const stoppedPosition = await playheadPosition();
        await page.waitForTimeout(250);
        await expect(playheadPosition()).resolves.toBe(stoppedPosition);
        await assertOffline();
    });

    test('undo restores durable project truth before its track edit', async ({ baseURL }, testInfo) => {
        await withExternalProjectPage(testInfo, baseURL, async (page, folderPath) => {
            const assertOffline = await openNewProject(page);
            await useExternalProjectFolder(page, folderPath);
            await renameProject(page, 'Smoke Undo Persistence');

            await addMidiTrack(page);
            const midiTrack = trackList(page).getByText('MIDI 1', { exact: true });
            await expect(midiTrack).toBeVisible();

            const undo = page.getByRole('button', { name: 'Undo', exact: true });
            await expect(undo).toBeEnabled();
            await undo.click();
            await expect(midiTrack).toHaveCount(0);
            await expect(page.getByText('Add your first track')).toBeVisible();

            await page.keyboard.press(`${MODIFIER}+s`);
            await expect(dirtyIndicator(page)).toHaveCount(0);
            await expectCommittedProjectFolder(page, folderPath);
            await startBlankProject(page);
            await assertOffline();

            const reopened = await openSavedProjectInFreshPage(page, 'Smoke Undo Persistence');
            try {
                await expect(reopened.page.getByTestId('project-name')).toHaveText('Smoke Undo Persistence');
                await expect(trackList(reopened.page).getByText('MIDI 1', { exact: true })).toHaveCount(0);
                await expect(reopened.page.getByText('Add your first track')).toBeVisible();
                await reopened.assertOffline();
            } finally {
                await reopened.page.close();
            }
        });
    });
});

test.describe('Crust runtime lifecycle', () => {
    for (const warm of [false, true]) {
        test(`keeps the live chain and history through ${warm ? 'Play before add' : 'cold add'}`, async ({
            page,
        }, testInfo) => {
            test.setTimeout(150_000);
            const errors: string[] = [];
            const pendingErrors: Promise<void>[] = [];
            page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
            page.on('console', (message) => {
                if (message.type() !== 'error') {
                    return;
                }
                pendingErrors.push(
                    Promise.all(
                        message.args().map((arg) =>
                            arg.evaluate((value: unknown) => {
                                const seen = new WeakSet<object>();
                                function describe(item: unknown): string {
                                    if (typeof item !== 'object' || item === null) {
                                        return String(item);
                                    }
                                    if (seen.has(item)) {
                                        return '[circular]';
                                    }
                                    seen.add(item);
                                    if (item instanceof Error) {
                                        const nested = item instanceof AggregateError ? item.errors.map(describe) : [];
                                        return [item.name, item.message, item.cause && describe(item.cause), ...nested]
                                            .filter(Boolean)
                                            .join(': ');
                                    }
                                    return Object.prototype.toString.call(item);
                                }
                                return describe(value);
                            })
                        )
                    ).then((parts) => {
                        errors.push(`${message.text()} ${parts.join(' ')}`);
                    })
                );
            });
            const assertOffline = await openNewProject(page);
            await addMidiTrack(page);
            const readState = () =>
                page.evaluate(async () => {
                    const { trackStore } = await import('/src/modules/Arrangement/stores/index.ts');
                    const audio = await import('/src/modules/AudioEngine/useCases/index.ts');
                    const { undoHistoryStore } = await import('/src/modules/Command/stores/index.ts');
                    const trackId = trackStore.value?.selectedTrackId;
                    const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
                    const strip = trackId ? audio.getTrackStrip(trackId) : undefined;
                    const entries = (items: NonNullable<typeof undoHistoryStore.value>['past']) =>
                        items.map((entry) => ({
                            id: entry.id,
                            action: entry.kind === 'action' ? entry.action.type : null,
                            deviceId:
                                entry.kind === 'action' && entry.action.type === 'addDevice'
                                    ? entry.action.payload.deviceId
                                    : null,
                        }));
                    return {
                        trackId,
                        stripExists: strip !== undefined,
                        devices: track?.devices.map(({ id, type }) => ({ id, type })) ?? [],
                        nodes:
                            strip?.deviceNodes.map((node) => ({
                                id: node.deviceId,
                                type: node.type,
                                ready: node.controller?.ready === true,
                                worklet: node.inputNode instanceof AudioWorkletNode,
                                nativeControls: Boolean(node.nativeDspControls),
                            })) ?? [],
                        readiness: audio.getDeviceReadinessDiagnostics().devices,
                        past: entries(undoHistoryStore.value?.past ?? []),
                        future: entries(undoHistoryStore.value?.future ?? []),
                    };
                });
            const before = await readState();
            expect(before.trackId).toBeTruthy();
            expect(before.devices.map(({ type }) => type)).toEqual(['builtin-synth']);
            if (warm) {
                await page.getByRole('button', { name: 'Play', exact: true }).click();
                await expect(page.getByRole('group', { name: 'Playback controls' }).getByRole('status')).toHaveText(
                    'Playing'
                );
            }
            const preAdd = await readState();
            const inspector = page.getByRole('complementary', { name: 'Inspector panel' });
            await inspector.getByRole('button', { name: 'Add device' }).click();
            await page.getByRole('menuitem', { name: /^Crust$/ }).click();
            await expect
                .poll(async () => (await readState()).devices.filter(({ type }) => type === 'crust').length)
                .toBe(1);
            await expect.poll(async () => (await readState()).past.at(-1)?.action).toBe('addDevice');
            const added = await readState();
            const deviceId = added.devices.find(({ type }) => type === 'crust')!.id;
            const entry = added.past.at(-1);
            expect(entry).toMatchObject({ action: 'addDevice', deviceId });
            expect(added.devices).toEqual([...before.devices, { id: deviceId, type: 'crust' }]);
            const expectReady = async () => {
                await expect
                    .poll(async () => {
                        const state = await readState();
                        return {
                            devices: state.devices,
                            nodes: state.nodes,
                            readiness: state.readiness.find((device) => device.deviceId === deviceId),
                        };
                    })
                    .toMatchObject({
                        devices: [...before.devices, { id: deviceId, type: 'crust' }],
                        nodes: [{ id: deviceId, type: 'crust', ready: true, worklet: true, nativeControls: true }],
                        readiness: { deviceId, deviceType: 'crust', status: 'ready', failureStage: null },
                    });
                const result = await page.evaluate(async () => {
                    const audio = await import('/src/modules/AudioEngine/useCases/index.ts');
                    return audio.waitForDevices();
                });
                expect(result.status).toBe('ready');
            };
            await expectReady();
            const afterAdd = await readState();
            const undo = page.getByRole('button', { name: 'Undo', exact: true });
            await expect(undo).toBeEnabled();
            await undo.click();
            await expect
                .poll(async () => {
                    const state = await readState();
                    return { devices: state.devices, nodes: state.nodes, future: state.future.at(-1) };
                })
                .toEqual({ devices: before.devices, nodes: [], future: entry });
            const afterUndo = await readState();
            const redo = page.getByRole('button', { name: 'Redo', exact: true });
            await expect(redo).toBeEnabled();
            await redo.click();
            await expect.poll(async () => (await readState()).past.at(-1)).toEqual(entry);
            await expectReady();
            const afterRedo = await readState();
            await testInfo.attach('crust-runtime-phases', {
                body: JSON.stringify({ warm, preAdd, afterAdd, afterUndo, afterRedo }, null, 2),
                contentType: 'application/json',
            });
            await expect(page.getByText(/requires runtime retry or repair/i)).toHaveCount(0);
            await assertOffline();
            await Promise.all(pendingErrors);
            expect(errors).toEqual([]);
        });
    }
});
