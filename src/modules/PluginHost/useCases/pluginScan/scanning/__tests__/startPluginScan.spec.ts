import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ScannedPlugin } from '../../../../models/ScannedPlugin';
import { type PluginScanAttempt } from '../../../../repositories/pluginBridge/scanPlugins';
import { type ScanResult } from '../../../../repositories/pluginBridge/types';
import { type PluginScanState } from '../../../../stores/pluginScanStore';
import { startPluginScan } from '../startPluginScan';

function create_scanned_plugin(overrides: Partial<ScannedPlugin> = {}): ScannedPlugin {
    return {
        id: 'plugin-id',
        name: 'Plugin',
        vendor: 'Vendor',
        format: 'vst3',
        category: 'instrument',
        path: '/plugins/plugin.vst3',
        version: '1.0.0',
        descriptor_id: 'com.test.plugin',
        num_inputs: 2,
        num_outputs: 2,
        num_parameters: 8,
        has_custom_ui: false,
        ...overrides,
    };
}

function create_plugin_scan_state(overrides: Partial<PluginScanState> = {}): PluginScanState {
    return {
        scanPaths: [],
        isScanning: false,
        scannedPlugins: [],
        errors: [],
        notices: [],
        lastScanTime: null,
        quarantined: [],
        ...overrides,
    };
}

/**
 * A scan result that completed. `complete: true` is the ordinary case — the
 * walk reached every candidate — and a test about an interrupted walk says so
 * by overriding it alongside the `scanned_paths` it did reach.
 */
function create_scan_result(overrides: Partial<ScanResult> = {}): ScanResult {
    return {
        plugins: [],
        errors: [],
        notices: [],
        scan_duration_ms: 0,
        quarantined: [],
        complete: true,
        scanned_paths: [],
        ...overrides,
    };
}

function create_deferred<ResultValue>() {
    let resolve_promise = (_value: ResultValue): void => {};
    const promise = new Promise<ResultValue>((resolve) => {
        resolve_promise = resolve;
    });

    return { promise, resolve: resolve_promise };
}

const mocks = vi.hoisted(() => {
    const pluginScanStoreValue: { value: PluginScanState } = {
        value: {
            scanPaths: [],
            isScanning: false,
            scannedPlugins: [],
            errors: [],
            notices: [],
            lastScanTime: null,
            quarantined: [],
        },
    };
    return {
        pluginScanStoreValue,
        pluginScanStoreSet: vi.fn<typeof import('../../../../stores/pluginScanStore').pluginScanStore.set>(),
        pluginScanStoreUpdate: vi.fn<typeof import('../../../../stores/pluginScanStore').pluginScanStore.update>(),
        scanPlugins: vi.fn<typeof import('../../../../repositories/pluginBridge/scanPlugins').scanPlugins>(),
        getDefaultPluginPaths:
            vi.fn<typeof import('../../../../repositories/pluginBridge/getDefaultPluginPaths').getDefaultPluginPaths>(),
        isScanPathAuthorized:
            vi.fn<typeof import('../../../../repositories/pluginBridge/isScanPathAuthorized').isScanPathAuthorized>(),
    };
});

vi.mock('../../../../stores/pluginScanStore', () => ({
    pluginScanStore: {
        get value() {
            return mocks.pluginScanStoreValue.value;
        },
        set: mocks.pluginScanStoreSet,
        update: mocks.pluginScanStoreUpdate,
    },
}));

vi.mock('../../../../repositories/pluginBridge/scanPlugins', () => ({
    scanPlugins: mocks.scanPlugins,
}));

vi.mock('../../../../repositories/pluginBridge/getDefaultPluginPaths', () => ({
    getDefaultPluginPaths: mocks.getDefaultPluginPaths,
}));

vi.mock('../../../../repositories/pluginBridge/isScanPathAuthorized', () => ({
    isScanPathAuthorized: mocks.isScanPathAuthorized,
}));

describe('startPluginScan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.pluginScanStoreValue.value = create_plugin_scan_state();
        mocks.pluginScanStoreSet.mockImplementation((value) => {
            if (value !== null) {
                mocks.pluginScanStoreValue.value = value;
            }
        });
        mocks.pluginScanStoreUpdate.mockImplementation((updater) => {
            const next_value = updater(mocks.pluginScanStoreValue.value);
            mocks.pluginScanStoreSet(next_value);
        });
        mocks.getDefaultPluginPaths.mockResolvedValue(['/default/path']);
        mocks.isScanPathAuthorized.mockResolvedValue(true);
    });

    it('sets isScanning and then updates with results', async () => {
        const mockPlugins = [create_scanned_plugin({ id: 'p1', name: 'Synth' })];
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result({ plugins: mockPlugins }),
        });

        await startPluginScan();

        // Check start state
        expect(mocks.pluginScanStoreSet).toHaveBeenCalledWith(expect.objectContaining({ isScanning: true }));

        // Check end state
        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                scannedPlugins: mockPlugins,
                errors: [],
            })
        );
    });

    it('keeps a scan that only refused formats out of the error channel', async () => {
        // The ordinary outcome for anyone who owns a plugin in a format Sourdaw
        // refuses: its folders are scanned like any other, so this runs on every
        // scan. Routed into `errors` it would render the scan destructively and
        // withhold the success badge — which is gated on `errors.length === 0`
        // — permanently, for a scan in which nothing failed.
        const refusal = 'VST2 plugins are not loaded and never will be.';
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result({
                plugins: [create_scanned_plugin({ id: 'p1', format: 'clap' })],
                notices: [refusal],
            }),
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: [],
                notices: [refusal],
            })
        );
    });

    it('reports failures and refusals on their own channels at once', async () => {
        // Neither channel absorbs the other: a scan can fail on one root and
        // refuse a format under another, and the user has to be able to tell
        // which is which.
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result({
                errors: ['Cannot read /default/path: permission denied'],
                notices: ['Audio Unit plugins are not loaded.'],
            }),
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                errors: ['Cannot read /default/path: permission denied'],
                notices: ['Audio Unit plugins are not loaded.'],
            })
        );
    });

    it('leaves the plugin list untouched when the scan could not run on this runtime', async () => {
        // Regression (#2305): the repository used to answer a browser runtime
        // with an empty `ScanResult`, and the unconditional
        // `scannedPlugins: result.plugins` write destroyed the persisted list —
        // one failed scan attempt and the user's plugin browser was empty. A
        // scan that never enumerated has nothing to say about the list.
        const previous_plugins = [create_scanned_plugin({ id: 'kept', name: 'Kept' })];
        mocks.pluginScanStoreValue.value = create_plugin_scan_state({
            scannedPlugins: previous_plugins,
            lastScanTime: 1_000,
        });
        mocks.scanPlugins.mockResolvedValue({ ran: false, reason: 'Plugin scanning requires the desktop app' });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['Plugin scanning requires the desktop app'],
                scannedPlugins: previous_plugins,
                lastScanTime: 1_000,
            })
        );
    });

    it('publishes the scanned list when a candidate failed', async () => {
        // Regression (#3497): the list used to be withheld whenever the result
        // carried any error, so one unreadable candidate — or one default root
        // the machine has never created — hid every plugin the scan did find.
        // The enumeration completed, so it is authoritative; the failure is
        // reported beside the list.
        const scanned_plugins = [
            create_scanned_plugin({ id: 'found-1', name: 'Found One' }),
            create_scanned_plugin({ id: 'found-2', name: 'Found Two' }),
        ];
        mocks.pluginScanStoreValue.value = create_plugin_scan_state({
            scannedPlugins: [create_scanned_plugin({ id: 'stale', name: 'Stale' })],
            lastScanTime: 1_000,
        });
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result({
                plugins: scanned_plugins,
                errors: ['Cannot read /default/path: permission denied'],
            }),
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['Cannot read /default/path: permission denied'],
                scannedPlugins: scanned_plugins,
                lastScanTime: expect.any(Number),
            })
        );
        const published = mocks.pluginScanStoreSet.mock.calls.at(-1)?.[0];
        expect(published?.lastScanTime).toBeGreaterThan(1_000);
    });

    it('keeps rows under roots an incomplete scan never reached', async () => {
        // An interrupted walk enumerated only the candidates it reached, and
        // the native registry keeps every row under a root it never got to.
        // Writing its plugins wholesale would drop those rows here while the
        // registry still holds them, so the browser would stop offering a
        // plugin the host can still load.
        // Distinct identities, as two different plugins always have: rows
        // sharing one are the same plugin, and the identity rule below covers
        // that case.
        const reached = create_scanned_plugin({ id: 'a', name: 'A', descriptor_id: 'com.vendor.a', path: '/r1/a' });
        const never_reached = create_scanned_plugin({
            id: 'b',
            name: 'B',
            descriptor_id: 'com.vendor.b',
            path: '/r2/b',
        });
        const rescanned = create_scanned_plugin({
            id: 'a',
            name: 'A renamed',
            descriptor_id: 'com.vendor.a',
            path: '/r1/a',
        });
        mocks.pluginScanStoreValue.value = create_plugin_scan_state({
            scannedPlugins: [reached, never_reached],
            lastScanTime: 1_000,
        });
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result({
                plugins: [rescanned],
                errors: ['Plugin scan time limit exceeded'],
                complete: false,
                scanned_paths: ['/r1/a'],
            }),
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['Plugin scan time limit exceeded'],
                scannedPlugins: [never_reached, rescanned],
            })
        );
    });

    it('keeps one row per plugin identity when an incomplete scan reaches a second copy', async () => {
        // The same plugin installed twice is still one plugin: the native list
        // carries one row per format-scoped identity, and a browser holding
        // two would list it twice, resolve a descriptor-addressed load to the
        // stale copy, and make the agent device manifest refuse the identity
        // as conflicting. The walk reached the per-user copy and stopped before
        // the machine-wide root, so the path rule alone cannot drop the old row.
        const machine_wide = create_scanned_plugin({
            id: 'machine-wide',
            name: 'X 1.5',
            format: 'clap',
            descriptor_id: 'com.vendor.x',
            path: '/Library/Audio/Plug-Ins/CLAP/X.clap',
        });
        const unrelated = create_scanned_plugin({
            id: 'b',
            name: 'B',
            descriptor_id: 'com.vendor.b',
            path: '/r2/b',
        });
        // No identity of its own, so nothing this scan found can claim it.
        const without_identity = create_scanned_plugin({
            id: 'e',
            name: 'E',
            format: 'clap',
            descriptor_id: '',
            path: '/r3/e',
        });
        const per_user = create_scanned_plugin({
            id: 'per-user',
            name: 'X 2.0',
            format: 'clap',
            descriptor_id: 'com.vendor.x',
            path: '/Users/u/Library/Audio/Plug-Ins/CLAP/X.clap',
        });
        mocks.pluginScanStoreValue.value = create_plugin_scan_state({
            scannedPlugins: [machine_wide, unrelated, without_identity],
            lastScanTime: 1_000,
        });
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result({
                plugins: [per_user],
                errors: ['Plugin scan time limit exceeded'],
                complete: false,
                scanned_paths: ['/Users/u/Library/Audio/Plug-Ins/CLAP/X.clap'],
            }),
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                scannedPlugins: [unrelated, without_identity, per_user],
            })
        );
    });

    it('replaces the whole list when the scan completed', async () => {
        // The other half: a complete walk enumerated everything installed, so
        // a row it did not report is a plugin that is gone. Keeping rows on a
        // complete result would let an uninstalled plugin survive forever.
        const stale = create_scanned_plugin({ id: 'a', name: 'A', path: '/r1/a' });
        const uninstalled = create_scanned_plugin({ id: 'b', name: 'B', path: '/r2/b' });
        const rescanned = create_scanned_plugin({ id: 'a', name: 'A renamed', path: '/r1/a' });
        mocks.pluginScanStoreValue.value = create_plugin_scan_state({
            scannedPlugins: [stale, uninstalled],
            lastScanTime: 1_000,
        });
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result({ plugins: [rescanned], scanned_paths: ['/r1/a'] }),
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                scannedPlugins: [rescanned],
            })
        );
    });

    it('replaces the list with a clean scan that genuinely found nothing', async () => {
        // Pins the distinction the keep-on-failure rules run on: an empty
        // result from a scan that ran cleanly is a valid enumeration — the
        // user removed their plugins — and must clear the list. Skipping the
        // write for any empty result would freeze a stale list forever.
        const previous_plugins = [create_scanned_plugin({ id: 'stale', name: 'Stale' })];
        mocks.pluginScanStoreValue.value = create_plugin_scan_state({
            scannedPlugins: previous_plugins,
            lastScanTime: 1_000,
        });
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result(),
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: [],
                scannedPlugins: [],
                lastScanTime: expect.any(Number),
            })
        );
    });

    it('merges existing paths with default paths', async () => {
        mocks.pluginScanStoreValue.value.scanPaths = ['/custom/path'];
        mocks.getDefaultPluginPaths.mockResolvedValue(['/default/path']);
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result(),
        });

        await startPluginScan();

        expect(mocks.scanPlugins).toHaveBeenCalledWith(expect.arrayContaining(['/custom/path', '/default/path']));
    });

    it('excludes saved paths the policy refuses from the scan request, with one notice naming them', async () => {
        // Regression (#2378): a path saved before the add was gated on the
        // scan policy used to reach the native scan on every run and come
        // back as a permanent "Unauthorized plugin scan path" error — red,
        // destructive, and never fixable from settings. The scan now asks the
        // policy first, sends only what it can authorize, and reports the
        // skipped paths once, on the informational channel.
        mocks.pluginScanStoreValue.value.scanPaths = ['/granted/path', '/ungranted/path'];
        mocks.getDefaultPluginPaths.mockResolvedValue([]);
        mocks.isScanPathAuthorized.mockImplementation((path: string) => Promise.resolve(path === '/granted/path'));
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result(),
        });

        await startPluginScan();

        expect(mocks.scanPlugins).toHaveBeenCalledWith(['/granted/path']);
        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: [],
                notices: [expect.stringContaining('/ungranted/path')],
            })
        );
    });

    it('reports a policy query that failed instead of scanning past it', async () => {
        // The partition decides what gets scanned; a query the bridge could
        // not answer makes the partition a guess. The scan refuses rather
        // than silently skipping or silently including a path.
        mocks.pluginScanStoreValue.value.scanPaths = ['/custom/path'];
        mocks.isScanPathAuthorized.mockRejectedValue(new Error('IPC Failure'));

        await startPluginScan();

        expect(mocks.scanPlugins).not.toHaveBeenCalled();
        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['IPC Failure'],
            })
        );
    });

    it('should not restore a scan path removed while scanPlugins is awaiting', async () => {
        mocks.pluginScanStoreValue.value.scanPaths = ['/removed/path'];
        mocks.getDefaultPluginPaths.mockResolvedValue([]);
        const scan_deferred = create_deferred<PluginScanAttempt>();
        mocks.scanPlugins.mockReturnValue(scan_deferred.promise);

        const scan_promise = startPluginScan();
        // The authorization round trip sits between the start and the scan
        // request now, so the request lands a few microtask ticks later than
        // the start call.
        await vi.waitFor(() => {
            expect(mocks.scanPlugins).toHaveBeenCalledWith(['/removed/path']);
        });

        mocks.pluginScanStoreValue.value = {
            ...mocks.pluginScanStoreValue.value,
            scanPaths: [],
        };
        scan_deferred.resolve({
            ran: true,
            result: create_scan_result(),
        });
        await scan_promise;

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                scanPaths: [],
                isScanning: false,
            })
        );
    });

    it('sets error if no paths are configured or found', async () => {
        mocks.getDefaultPluginPaths.mockResolvedValue([]);

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['No plugin paths configured'],
            })
        );
    });

    it('handles repository errors gracefully', async () => {
        mocks.scanPlugins.mockRejectedValue(new Error('IPC Failure'));

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['IPC Failure'],
            })
        );
    });

    it('leaves the plugin list untouched when the scan throws', async () => {
        // A throw means no result reached the renderer at all. A scan that ran
        // out of its own budget is not one of these: it answers with the
        // plugins it found and names the limit in `errors`. With no result,
        // nothing may restate the list the user's browser is showing.
        const previous_plugins = [create_scanned_plugin({ id: 'kept', name: 'Kept' })];
        mocks.pluginScanStoreValue.value = create_plugin_scan_state({
            scannedPlugins: previous_plugins,
            lastScanTime: 1_000,
        });
        mocks.scanPlugins.mockRejectedValue(new Error('Plugin scan task failed: the native host went away'));

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isScanning: false,
                errors: ['Plugin scan task failed: the native host went away'],
                scannedPlugins: previous_plugins,
                lastScanTime: 1_000,
            })
        );
    });

    it('no-ops when a scan is already in flight', async () => {
        mocks.pluginScanStoreValue.value.isScanning = true;

        await startPluginScan();

        // Guard returns before touching the store or the IPC bridge.
        expect(mocks.pluginScanStoreSet).not.toHaveBeenCalled();
        expect(mocks.getDefaultPluginPaths).not.toHaveBeenCalled();
        expect(mocks.scanPlugins).not.toHaveBeenCalled();
    });

    it('calls the repository with a single argument on the default scan, matching every call site before this flag existed', async () => {
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result(),
        });

        await startPluginScan();

        expect(mocks.scanPlugins.mock.calls.at(-1)).toHaveLength(1);
    });

    it('forwards an explicit retry flag to the repository', async () => {
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result(),
        });

        await startPluginScan({ retryQuarantined: true });

        expect(mocks.scanPlugins).toHaveBeenCalledWith(expect.any(Array), true);
    });

    it('replaces the quarantined list with the registry snapshot the scan reported', async () => {
        const previous_quarantine = [
            { path: '/plugins/old.vst3', reason: 'Plugin scan helper timed out', quarantined_at_ms: 1 },
        ];
        mocks.pluginScanStoreValue.value = create_plugin_scan_state({ quarantined: previous_quarantine });
        const fresh_quarantine = [
            {
                path: '/plugins/broken.vst3',
                reason: 'Plugin scan helper exited unsuccessfully for /plugins/broken.vst3',
                quarantined_at_ms: 2,
            },
        ];
        mocks.scanPlugins.mockResolvedValue({
            ran: true,
            result: create_scan_result({ quarantined: fresh_quarantine }),
        });

        await startPluginScan();

        expect(mocks.pluginScanStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({ quarantined: fresh_quarantine })
        );
    });
});
