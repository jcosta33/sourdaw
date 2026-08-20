/**
 * Plugin scan state store.
 * Owned by the Plugin module — scan state is a Plugin concern, not an AudioEngine concern.
 */

import { createStore } from '#/infra/store/createStore';
import { createPlainJsonLocalStorage } from '#/infra/store/storage/createPlainJsonLocalStorage';

import { type ScannedPlugin, type ScannedPluginParameter } from '../models/ScannedPlugin';

export type PluginScanState = {
    scannedPlugins: ScannedPlugin[];
    scanPaths: string[];
    isScanning: boolean;
    lastScanTime: number | null;
    /** Failures from the last scan. Rendered destructively; gates the success badge. */
    errors: string[];
    /**
     * Informational messages from the last scan — the reason a recognised
     * plugin format is not loaded.
     *
     * A separate field from `errors` and not a subset of it: these describe a
     * scan that succeeded, so they must not be rendered as failures and must
     * not withhold the success state. The VST3 roots are scanned by default on
     * every platform, so this is non-empty for most users on every scan.
     */
    notices: string[];
};

export const defaultPluginScanState: PluginScanState = {
    scannedPlugins: [],
    scanPaths: [],
    isScanning: false,
    lastScanTime: null,
    errors: [],
    notices: [],
};

const PLUGIN_SCAN_KEY = 'sourdaw:plugin-scan';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function readStrings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readParameter(value: unknown): ScannedPluginParameter | null {
    if (
        !isRecord(value) ||
        typeof value.id !== 'number' ||
        typeof value.name !== 'string' ||
        typeof value.min_value !== 'number' ||
        typeof value.max_value !== 'number' ||
        typeof value.default_value !== 'number' ||
        typeof value.is_automatable !== 'boolean' ||
        typeof value.is_modulatable !== 'boolean' ||
        typeof value.is_stepped !== 'boolean' ||
        typeof value.is_enum !== 'boolean'
    ) {
        return null;
    }
    const parameterModule = readString(value.module);
    return {
        id: value.id,
        name: value.name,
        ...(parameterModule === null ? {} : { module: parameterModule }),
        min_value: value.min_value,
        max_value: value.max_value,
        default_value: value.default_value,
        is_automatable: value.is_automatable,
        is_modulatable: value.is_modulatable,
        is_stepped: value.is_stepped,
        is_enum: value.is_enum,
    };
}

/**
 * Rebuild a stored plugin field by field.
 *
 * Nothing is passed through unread: the persisted value is the only input to
 * this store that a user can edit by hand, and `getAgentDeviceFactoryManifest`
 * treats a scanned plugin's parameter descriptors as a contract it validates
 * against `num_parameters`. A plugin missing any field, or carrying a
 * `parameters` array with a bad row in it, is dropped rather than repaired —
 * the next scan is what restores it, and a half-read plugin would resolve to a
 * device the host cannot build.
 */
function readScannedPlugin(value: unknown): ScannedPlugin | null {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.vendor !== 'string' ||
        typeof value.format !== 'string' ||
        typeof value.category !== 'string' ||
        typeof value.path !== 'string' ||
        typeof value.version !== 'string' ||
        typeof value.clap_id !== 'string' ||
        typeof value.num_inputs !== 'number' ||
        typeof value.num_outputs !== 'number' ||
        typeof value.num_parameters !== 'number' ||
        typeof value.has_custom_ui !== 'boolean'
    ) {
        return null;
    }

    let parameters: ScannedPluginParameter[] | undefined;
    if (value.parameters !== undefined) {
        if (!Array.isArray(value.parameters)) {
            return null;
        }
        parameters = [];
        for (const storedParameter of value.parameters) {
            const parameter = readParameter(storedParameter);
            if (parameter === null) {
                return null;
            }
            parameters.push(parameter);
        }
    }
    const parameterMetadataReason = readString(value.parameter_metadata_reason);
    // Restored with the counts it qualifies. Dropping it here would turn an
    // unqueried default back into a measurement on the next launch, which is the
    // fabrication this field exists to prevent.
    const capabilityMetadataReason = readString(value.capability_metadata_reason);

    return {
        id: value.id,
        name: value.name,
        vendor: value.vendor,
        format: value.format,
        category: value.category,
        path: value.path,
        version: value.version,
        clap_id: value.clap_id,
        num_inputs: value.num_inputs,
        num_outputs: value.num_outputs,
        num_parameters: value.num_parameters,
        has_custom_ui: value.has_custom_ui,
        ...(parameters === undefined ? {} : { parameters }),
        ...(parameterMetadataReason === null ? {} : { parameter_metadata_reason: parameterMetadataReason }),
        ...(capabilityMetadataReason === null ? {} : { capability_metadata_reason: capabilityMetadataReason }),
    };
}

/**
 * Decode the persisted scan state.
 *
 * `isScanning` is never restored. A scan that was running when the window went
 * away did not finish, and reading `true` back would leave the UI in a scan
 * that no longer exists and that the use cases' in-flight guard would then
 * refuse to replace. `errors` and `notices` are dropped for the same reason:
 * both described the run that is gone, and the next scan is what restates
 * whichever of them still applies.
 */
function readPluginScanState(value: unknown): PluginScanState | null {
    if (!isRecord(value)) {
        return null;
    }

    const scannedPlugins = Array.isArray(value.scannedPlugins)
        ? value.scannedPlugins.map(readScannedPlugin).filter((plugin): plugin is ScannedPlugin => plugin !== null)
        : [];

    return {
        scannedPlugins,
        scanPaths: readStrings(value.scanPaths),
        isScanning: false,
        lastScanTime: typeof value.lastScanTime === 'number' ? value.lastScanTime : null,
        errors: [],
        notices: [],
    };
}

/**
 * `discardStoredValueOnRefusedWrite`, because the alternative is silently
 * restoring a scan the user has already replaced.
 *
 * A refused `setItem` leaves the PREVIOUS document in the key. Here that
 * document is a whole scan result: the plugin list from an earlier folder
 * configuration, with the parameter contracts that went with it. The next
 * launch would restore it and nothing downstream could tell it apart from the
 * current one — `getAgentDeviceFactoryManifest` reads those contracts and
 * advertises a factory version derived from them, so a superseded copy is
 * advertised as fact. Starting empty is legible: no plugins until a scan, which
 * is what a first run looks like and what the UI already handles.
 */
const persistedScanState = createPlainJsonLocalStorage<PluginScanState>({
    key: PLUGIN_SCAN_KEY,
    decode: readPluginScanState,
    discardStoredValueOnRefusedWrite: true,
});

/**
 * The persisted scan state, with a `set` that cannot unwind its caller.
 *
 * A scanned plugin carries its full scan-time parameter contract, so a large
 * plugin folder is the one value in this app big enough for `localStorage` to
 * refuse on quota. The adapter's `set` answers that by throwing — which lands
 * in the middle of a scan that has already succeeded, and whose own error
 * handler writes to this same store and so throws again, leaving `isScanning`
 * true with nothing able to clear it.
 *
 * `trySet` is the adapter's own non-throwing write: the value goes live for the
 * session, the dropped write is logged and raises the storage-full notice once,
 * and the user's plugin list works now and needs a rescan after a reload. That
 * is the honest outcome of a refused write here; a stranded scan is not.
 *
 * Overriding the adapter rather than calling `pluginScanStore.trySet()` at the
 * write sites is deliberate, and `Store.update()` is the reason: it is
 * hard-wired to `store.set`, with no `tryUpdate` beside it, and the writes that
 * carry a full scan result — `startPluginScan`, `scanCustomPaths` — are
 * read-modify-write and so go through `update`. A call site here cannot opt
 * into the non-throwing path, so the opt-in has to sit under it. If `update`
 * ever grows a non-throwing form, delete this object and let the call sites
 * choose, which is the repository's normal shape.
 */
const scanStateStorage: typeof persistedScanState = {
    ...persistedScanState,
    set(value: PluginScanState | null): void {
        persistedScanState.trySet?.(value);
    },
};

/**
 * Scan results and scan folders outlive the session.
 *
 * The native side owns the registry that plugin activation resolves against and
 * persists it itself; this is the browsable list and the user's configured scan
 * folders, which are renderer state and belong in renderer storage. Persisting
 * here rather than reading the native registry back keeps the whole hydration
 * inside the store contract that already exists — no new native command, no new
 * bridge surface, and the web target keeps whatever it scanned too.
 */
export const pluginScanStore = createStore<PluginScanState>({
    initialData: defaultPluginScanState,
    storage: scanStateStorage,
});
