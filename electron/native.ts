/**
 * Loading the `sourdaw-native` addon, and the shape the rest of the shell sees.
 *
 * The addon is a compiled `.node` built from `crates/sourdaw-native` with the
 * `napi-addon` feature. It is not a JS package and has no type declarations, so
 * this file is the one place that faces an untyped module — and it validates
 * the shape it got instead of asserting it. A `require` that returned the wrong
 * thing (a stale build, a partially linked binary) must fail here, naming what
 * was missing, rather than at the first command a musician invokes.
 *
 * Everything below takes its loader as an argument. That is what lets the specs
 * exercise the validation and the resolution without a compiled binary present.
 */
import { join } from 'node:path';

/**
 * A command method on the addon.
 *
 * Positional and opaque: the router forwards the renderer's argument array
 * unchanged, so nothing in the shell declares what any command's parameters are
 * called. The addon's napi-rs deserialization is the boundary that rejects a
 * malformed payload, exactly as serde did under Tauri.
 */
export type NativeCommand = (...args: readonly unknown[]) => unknown;

/** Every pushed event, as the addon's threadsafe function delivers it. */
export type NativeEventCallback = (event: string, payload: unknown) => void;

/**
 * The live native host: one instance for the life of the process, holding every
 * managed singleton the command bodies address.
 */
/** What a file grant permits, in the addon's own wire vocabulary. */
export type FileGrantMode = 'read' | 'readwrite';

export type NativeHost = {
    /** Run the exit cascade. Synchronous today; see `shutdown.ts`. */
    readonly shutdown: () => unknown;
    /**
     * Grant the renderer access to one path the user picked.
     *
     * Declared here rather than reached through the generic command record
     * because it is main-process-only by design: it is withheld from
     * `EXPOSED_COMMANDS`, so the dialogs that mint grants are its only callers
     * and they call it with named, checked arguments.
     */
    readonly grantPath: (path: string, mode: FileGrantMode, recursive: boolean) => Promise<void>;
    /** Dedicated dictation controls stay outside generic renderer command routing. */
    readonly startDictation: (sessionId: string) => Promise<string>;
    readonly stopDictation: (sessionId: string) => void;
    readonly cancelDictation: (sessionId: string) => Promise<void>;
} & Record<string, NativeCommand>;

export type NativeAddon = {
    readonly SourdawNative: new (onEvent: NativeEventCallback) => NativeHost;
};

/** Overrides the resolved addon path. Set by the dev shell and by packaging. */
export const NATIVE_ADDON_PATH_ENV = 'SOURDAW_NATIVE_ADDON';

export type ResolveNativeAddonPathInput = {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly isPackaged: boolean;
    /** `process.resourcesPath` — where an unpacked addon ships in a packaged app. */
    readonly resourcesPath: string;
    /** The repository root, used only when running unpackaged. */
    readonly repoRoot: string;
};

/** The addon file name, under the napi-rs convention of a `.node` beside its crate. */
export const NATIVE_ADDON_FILE = 'sourdaw-native.node';

/**
 * Where the addon binary is.
 *
 * Packaged, it sits in `resources/` unpacked: a `.node` inside an asar cannot
 * be `dlopen`ed, so it has to be a real file on disk. Unpackaged, it is the
 * artifact beside its own crate. The env override exists because both of those
 * are conventions, and a developer bisecting an addon change needs to point the
 * shell at a specific build without editing this file.
 */
export const resolveNativeAddonPath = ({
    env,
    isPackaged,
    resourcesPath,
    repoRoot,
}: ResolveNativeAddonPathInput): string => {
    const override = env[NATIVE_ADDON_PATH_ENV];
    if (override !== undefined && override !== '') {
        return override;
    }
    if (isPackaged) {
        return join(resourcesPath, NATIVE_ADDON_FILE);
    }
    return join(repoRoot, 'crates', 'sourdaw-native', NATIVE_ADDON_FILE);
};

/** Overrides the resolved plugin-scan leaf helper path. Set by the dev shell and by packaging. */
export const NATIVE_SCAN_HELPER_PATH_ENV = 'SOURDAW_PLUGIN_SCAN_HELPER';

/**
 * The plugin-scan leaf helper's file name for a platform.
 *
 * A function of `platform` rather than a bare constant so a spec can assert
 * the Windows suffix without running on Windows.
 */
export const NATIVE_SCAN_HELPER_FILE = (platform: NodeJS.Platform): string =>
    platform === 'win32' ? 'sourdaw-plugin-scan-helper.exe' : 'sourdaw-plugin-scan-helper';

export type ResolveScanHelperPathInput = {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly isPackaged: boolean;
    /** `process.resourcesPath` — where the helper ships in a packaged app. */
    readonly resourcesPath: string;
    /** The repository root, used only when running unpackaged. */
    readonly repoRoot: string;
    readonly platform: NodeJS.Platform;
};

/**
 * Where the plugin-scan leaf helper executable is.
 *
 * The same three branches as {@link resolveNativeAddonPath}, for the same
 * reasons: packaged, it ships unpacked in `resources/` so the Rust scan
 * policy can spawn it as a real process; unpackaged, it is the artifact
 * beside its own crate; the env override lets a developer point at a specific
 * build without editing this file.
 */
export const resolveScanHelperPath = ({
    env,
    isPackaged,
    resourcesPath,
    repoRoot,
    platform,
}: ResolveScanHelperPathInput): string => {
    const override = env[NATIVE_SCAN_HELPER_PATH_ENV];
    if (override !== undefined && override !== '') {
        return override;
    }
    if (isPackaged) {
        return join(resourcesPath, NATIVE_SCAN_HELPER_FILE(platform));
    }
    return join(repoRoot, 'crates', 'sourdaw-native', NATIVE_SCAN_HELPER_FILE(platform));
};

/**
 * The entry points the shell dereferences by name, and the only ones validated
 * here.
 *
 * The command methods are not checked at load: they are checked as a set by
 * `commands.spec.ts`, against the addon's own Rust source, which catches a
 * missing method at test time rather than at the moment a user needs it.
 */
const REQUIRED_ADDON_EXPORTS = ['SourdawNative'] as const;

const missingAddonExports = (loaded: object): string[] =>
    REQUIRED_ADDON_EXPORTS.filter((name) => !(name in loaded && typeof Reflect.get(loaded, name) === 'function'));

const isNativeAddon = (loaded: object): loaded is NativeAddon => missingAddonExports(loaded).length === 0;

/** Validate a loaded module against the surface the shell depends on. */
export const asNativeAddon = (loaded: unknown, path: string): NativeAddon => {
    if (typeof loaded !== 'object' || loaded === null) {
        throw new TypeError(`The native addon at ${path} did not export an object`);
    }
    if (!isNativeAddon(loaded)) {
        throw new TypeError(`The native addon at ${path} is missing: ${missingAddonExports(loaded).join(', ')}`);
    }
    return loaded;
};

export type LoadNativeAddonInput = {
    readonly path: string;
    /** `createRequire(import.meta.url)` in production; a stub in the specs. */
    readonly load: (path: string) => unknown;
};

export const loadNativeAddon = ({ path, load }: LoadNativeAddonInput): NativeAddon => asNativeAddon(load(path), path);
