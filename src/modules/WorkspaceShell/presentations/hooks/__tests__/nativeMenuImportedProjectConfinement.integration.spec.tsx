import { File as PlatformFile } from 'node:buffer';

import { getHeads, toJS } from '@automerge/automerge';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';
import { setNotificationEventBus } from '#/utils/Notification/notificationEventBus';

import { NATIVE_MENU_PROJECT_STATE_CHANNEL } from '../../../../../../electron/channels';

import {
    expectedHostileShellName,
    hostileProject,
    ordinaryProject,
    predecessorProject,
} from './helpers/nativeMenuImportFixture';
import { nativeMenuImportPlatform as platform } from './helpers/nativeMenuImportPlatform';

import type { NotifyPayload, ConfirmPayload, PromptPayload } from '#/utils/Notification/notificationEventBus';
import type { ApplicationMenuTemplateItem } from '../../../../../../electron/applicationMenu';

vi.mock('electron', async () => {
    const { nativeMenuImportPlatform } = await import('./helpers/nativeMenuImportPlatform');
    return nativeMenuImportPlatform.electron;
});

// The compiled addon is an external filesystem adapter. Keep the actual main
// composition, dialog admission, preload, command router and payload parsing.
vi.mock('../../../../../../electron/native.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../../../electron/native.js')>();
    const { nativeMenuImportPlatform } = await import('./helpers/nativeMenuImportPlatform');
    return { ...actual, loadNativeAddon: () => nativeMenuImportPlatform.nativeAddon };
});

let platformDescriptor: PropertyDescriptor | undefined;
let locksDescriptor: PropertyDescriptor | undefined;
let stdoutListeners: Array<(error: Error) => void> = [];
let stderrListeners: Array<(error: Error) => void> = [];
const disposers: Array<() => void | Promise<void>> = [];
const notifications: NotifyPayload[] = [];

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

function requireMenuItem(label: string, items = platform.menu()): ApplicationMenuTemplateItem {
    for (const item of items) {
        if (item.label === label) {
            return item;
        }
        if (item.submenu) {
            const found = findMenuItem(label, item.submenu);
            if (found) {
                return found;
            }
        }
    }
    throw new Error(`Actual application menu lacks ${label}`);
}

function findMenuItem(label: string, items: ApplicationMenuTemplateItem[]): ApplicationMenuTemplateItem | undefined {
    for (const item of items) {
        if (item.label === label) {
            return item;
        }
        const found = item.submenu ? findMenuItem(label, item.submenu) : undefined;
        if (found) {
            return found;
        }
    }
    return undefined;
}

beforeEach(() => {
    platform.reset();
    notifications.length = 0;
    const eventBus = createEventBus<NotificationEvents>();
    setNotificationEventBus(eventBus);
    const unsubscribeNotifications = eventBus.on('ui.notify', (payload) => {
        notifications.push(payload);
    });
    disposers.push(async () => {
        await eventBus.waitForIdle();
        unsubscribeNotifications();
    });
    platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
    locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
    Object.defineProperty(navigator, 'locks', { configurable: true, value: createControlledLockManager().locks });
    vi.stubGlobal('indexedDB', new IDBFactory());
    vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    vi.stubGlobal('File', PlatformFile);
    vi.stubEnv('SOURDAW_DESKTOP_RUNTIME_SCOPE_ROOT', undefined);
    vi.stubEnv('SOURDAW_DESKTOP_DEV', undefined);
    vi.stubEnv('SOURDAW_PLUGIN_SCAN_WORKER_COMMAND', process.env.SOURDAW_PLUGIN_SCAN_WORKER_COMMAND);
    localStorage.clear();
    sessionStorage.clear();
    stdoutListeners = process.stdout.listeners('error');
    stderrListeners = process.stderr.listeners('error');
});

afterEach(async () => {
    cleanup();
    for (const dispose of disposers.splice(0)) {
        await dispose();
    }
    for (const listener of process.stdout.listeners('error')) {
        if (!stdoutListeners.includes(listener)) {
            process.stdout.removeListener('error', listener);
        }
    }
    for (const listener of process.stderr.listeners('error')) {
        if (!stderrListeners.includes(listener)) {
            process.stderr.removeListener('error', listener);
        }
    }
    Reflect.deleteProperty(window, 'sourdaw');
    if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor);
    }
    if (locksDescriptor) {
        Object.defineProperty(navigator, 'locks', locksDescriptor);
    } else {
        Reflect.deleteProperty(navigator, 'locks');
    }
    vi.restoreAllMocks();
    Container.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    platform.reset();
});

describe('imported project names at the actual native menu boundary', () => {
    it('preserves imported CRDT truth while confining title, Recent and close-dialog strings', async () => {
        const crdt = await import('#/modules/CrdtDocument/useCases');
        const project = await import('#/modules/Project/useCases');
        const { projectStore } = await import('#/modules/Project/stores');
        const command = await import('#/modules/Command/useCases');
        const { undoHistoryStore } = await import('#/modules/Command/stores');
        const { leaveSession } = await import('#/modules/Collaboration/useCases');
        const { registerProjectSlotProjections } = await import('#/app/registerProjectSlotProjections');
        const { registerProjectLifecycle } = await import('#/app/registerProjectLifecycle');
        const { registerDeviceEnginePorts } = await import('#/app/registerDeviceEnginePorts');
        const { registerSupportingServicePorts } = await import('#/app/registerSupportingServicePorts');
        const { registerKernelPorts } = await import('#/app/registerKernelPorts');
        const { configureProjectOriginalMediaPort } = await import('#/app/configureProjectOriginalMediaPort');
        const { useProjectState } = await import('../useProjectState');
        const { useNativeApplicationMenu } = await import('../useNativeApplicationMenu');

        crdt.registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        registerProjectLifecycle();
        registerDeviceEnginePorts();
        registerSupportingServicePorts();
        registerKernelPorts();
        configureProjectOriginalMediaPort();
        project.setProjectIdentityTransitionDependencies({ leaveCollaborationSession: leaveSession });
        command.setActionHistoryMetadataPort({
            record: crdt.recordActionHistoryEntry,
            recordBatch: crdt.recordActionHistoryEntries,
            markReverted: crdt.markActionHistoryEntryReverted,
            clear: crdt.clearActionHistory,
        });
        crdt.sessionUndoWitnessStampPort.setProvider(command.stampSessionUndoWitness);
        const stopHistory = crdt.subscribeToPublishedActionHistory({
            onHistory: command.syncActionReplayMetadata,
            onRootReplaced: command.resetActionReplayAuthority,
        });
        const stopDirtyTracking = project.initProjectDirtyTracking();
        const autosaves = vi.spyOn(crdt, 'startCrdtAutoSave');
        disposers.push(async () => {
            for (const result of autosaves.mock.results) {
                if (result.type === 'return') {
                    result.value();
                }
            }
            await crdt.runCrdtPersistenceBarrier(async ({ persistCurrentProject }) => {
                await persistCurrentProject();
            });
            stopDirtyTracking();
            stopHistory();
            project.projectOriginalMediaPort.configure(null);
        });
        crdt.initBranchState();
        await crdt.whenBranchStateSettled();

        // The real interchange owner establishes readiness. The assertions
        // below still require both imports to arrive through native clicks.
        await expect(project.applyImportedProjectData({ data: predecessorProject.data })).resolves.toBe(true);

        await import('../../../../../../electron/main');
        await waitFor(() => {
            expect(platform.windows).toHaveLength(1);
            expect(platform.hasChannel(NATIVE_MENU_PROJECT_STATE_CHANNEL)).toBe(true);
        });
        await import('../../../../../../electron/preload');
        const host = renderHook(() => {
            const current = useProjectState();
            useNativeApplicationMenu(current);
            return current;
        });
        await waitFor(() => expect(platform.titles.at(-1)).toBe('Ready predecessor — Sourdaw'));

        for (const { fixture, expectedName } of [
            { fixture: ordinaryProject, expectedName: ordinaryProject.data.meta.name },
            { fixture: hostileProject, expectedName: expectedHostileShellName },
        ]) {
            const path = `/selected/${fixture.data.meta.projectId}.sourdaw`;
            platform.selectFile(path, fixture.bytes);
            platform.titles.length = 0;
            const item = requireMenuItem('Import Project…');
            expect(item.click).toBeTypeOf('function');
            await act(async () => item.click?.());
            await waitFor(() => {
                expect(host.result.current.projectId).toBe(fixture.data.meta.projectId);
                expect(host.result.current.loading).toBe(false);
                expect(host.result.current.name).toBe(fixture.data.meta.name);
                expect(platform.titles.at(-1)).toBe(`${expectedName} — Sourdaw`);
            });
            const root = crdt.getCrdtDoc<{ projectMeta?: { name?: string } }>(crdt.DOC_PREFIX_ROOT);
            expect(root?.projectMeta?.name).toBe(fixture.data.meta.name);
            expect(platform.reads).toContain(path);
            const originalBytes = platform.fileBytes(path);
            if (!originalBytes) {
                throw new Error('The selected source file disappeared');
            }
            expect([...originalBytes]).toEqual([...fixture.bytes]);
            await act(async () => {
                await expect(project.saveProject()).resolves.toBe(true);
            });
            await waitFor(() => {
                const recent = requireMenuItem('Open Recent').submenu;
                expect(recent?.map((entry) => entry.label)).toContain(expectedName);
                expect(
                    project.getRecentProjects().find((entry) => entry.name === fixture.data.meta.name)
                ).toBeDefined();
            });
        }

        const captureTruth = () => {
            const root = crdt.getCrdtDoc(crdt.DOC_PREFIX_ROOT);
            if (!root) {
                throw new Error('Imported project root is absent');
            }
            return {
                document: toJS(root),
                heads: getHeads(root),
                history: structuredClone(undoHistoryStore.value),
                projectId: projectStore.value?.projectId,
                name: projectStore.value?.name,
            };
        };
        const beforeShell = captureTruth();
        expect([...expectedHostileShellName]).toHaveLength(256);
        expect(beforeShell.name).toBe(hostileProject.data.meta.name);
        await act(async () => project.markDirty());
        await waitFor(() => {
            const payloads = platform.ipcCalls
                .filter((call) => call.channel === NATIVE_MENU_PROJECT_STATE_CHANNEL)
                .map((call) => call.args[0]);
            expect(payloads.at(-1)).toMatchObject({
                title: hostileProject.data.meta.name,
                dirty: true,
                rendererReady: true,
            });
        });
        const window = platform.windows[0];
        if (!window) {
            throw new Error('Actual main window was never created');
        }
        await act(async () => window.close());
        await waitFor(() => expect(platform.dialogs).toHaveLength(1));
        expect(platform.dialogs[0]).toMatchObject({
            message: `Do you want to save the changes you made to “${expectedHostileShellName}”?`,
            buttons: ['Save', 'Don’t Save', 'Cancel'],
        });
        expect(window.isDestroyed()).toBe(false);
        expect(captureTruth()).toEqual(beforeShell);
        expect(projectStore.value?.dirty).toBe(true);
        expect(platform.pluginUnloads).toEqual([undefined, undefined]);
        expect(notifications).toEqual([]);
    }, 30_000);
});
