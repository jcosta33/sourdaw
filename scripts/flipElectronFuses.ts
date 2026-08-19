#!/usr/bin/env node
/**
 * electron-builder `afterPack` hook: flip the Electron fuses, then read them
 * back off the packed binary (REQ-010).
 *
 * Fuses are bytes patched into the shipped Electron binary — on macOS into
 * `Electron Framework`, not the app's own executable — so they are the only
 * hardening in this repository that cannot be expressed in code the shell
 * runs. Four are set here:
 *
 * - `RunAsNode: false` — `ELECTRON_RUN_AS_NODE=1` in the environment otherwise
 *   turns the signed, entitled app bundle into a general-purpose Node
 *   interpreter. Nothing in the shell needs it: plugin scanning runs in a
 *   `utilityProcess`, which is unaffected, unlike `child_process.fork`.
 * - `OnlyLoadAppFromAsar: true` — collapses Electron's `app.asar` → `app` →
 *   `default_app.asar` search to a single entry, so dropping an unpacked `app`
 *   directory beside the archive cannot substitute code for the shipped app.
 * - `EnableEmbeddedAsarIntegrityValidation: true` — validates `app.asar`
 *   against the hash electron-builder writes into `Info.plist`, which the code
 *   signature covers. Only meaningful together with the fuse above; with both
 *   set, a tampered archive refuses to boot.
 * - `EnableCookieEncryption: true` — Chromium's cookie store is plaintext
 *   SQLite by default. Collaboration session cookies live there.
 * - `EnableNodeOptionsEnvironmentVariable: false` and
 *   `EnableNodeCliInspectArguments: false` — `NODE_OPTIONS` and
 *   `--inspect`/`--inspect-brk` are the same local-injection class
 *   `RunAsNode` closes: an environment or argument that turns the entitled
 *   process into an attacker's runtime. Chromium's own
 *   `--remote-debugging-port` is unaffected, so packaged-app verification
 *   over CDP keeps working.
 * - `GrantFileProtocolExtraPrivileges: false` — everything the shell serves
 *   crosses `app://`; `file://` needs no privileges here, so it gets none.
 *
 * The read-back is the point of the second half. `flipFuses` reports how many
 * sentinels it patched, not whether the wire ended up in the requested state,
 * and a silently un-flipped fuse is invisible in every artifact the build
 * produces. `getCurrentFuseWire` re-reads the binary from disk, so this check
 * fails if the flip did not take. It reads the first Mach-O slice only —
 * complete while the mac target is arm64-only; a `universal` target would
 * need a per-slice read-back before it could trust this check.
 *
 * Ordering: electron-builder emits `afterPack` before `sanityCheckPackage` and
 * before signing, so the ad-hoc signature applied afterwards covers the patched
 * binary. Patching after signing would leave an app macOS refuses to launch on
 * Apple silicon.
 *
 * electron-builder resolves a hook module by looking up its own hook name as a
 * named export before falling back to a default one, so `afterPack` below is
 * the entry point.
 */
import { join } from 'node:path';

import { flipFuses, getCurrentFuseWire, FuseState, FuseV1Options, FuseVersion } from '@electron/fuses';

/**
 * The slice of electron-builder's `AfterPackContext` this hook reads.
 *
 * Declared locally rather than imported from `app-builder-lib`: the hook is
 * loaded by electron-builder at build time and is not part of any TypeScript
 * project that resolves its types, and a structural type states exactly which
 * fields the contract depends on.
 */
export type AfterPackContext = {
    readonly appOutDir: string;
    readonly electronPlatformName: string;
    readonly packager: {
        readonly appInfo: {
            readonly productFilename: string;
        };
        readonly executableName?: string;
    };
};

/** Fuse states this build refuses to ship without. */
export const REQUIRED_FUSES: ReadonlyMap<FuseV1Options, boolean> = new Map([
    [FuseV1Options.RunAsNode, false],
    [FuseV1Options.OnlyLoadAppFromAsar, true],
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
    [FuseV1Options.EnableCookieEncryption, true],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
    [FuseV1Options.EnableNodeCliInspectArguments, false],
    [FuseV1Options.GrantFileProtocolExtraPrivileges, false],
]);

const PLATFORM_SUFFIX: Readonly<Record<string, string>> = {
    darwin: '.app',
    mas: '.app',
    win32: '.exe',
    linux: '',
};

/**
 * The path `@electron/fuses` expects: the `.app` bundle on macOS, the
 * executable itself elsewhere. Mirrors what electron-builder's own fuse step
 * computes, so a hook and a config-driven flip address the same binary.
 */
export const resolveElectronBinaryPath = (context: AfterPackContext): string => {
    const suffix = PLATFORM_SUFFIX[context.electronPlatformName] ?? '';
    const name = context.packager.executableName ?? context.packager.appInfo.productFilename;
    return join(context.appOutDir, `${name}${suffix}`);
};

const expectedState = (enabled: boolean): FuseState => (enabled ? FuseState.ENABLE : FuseState.DISABLE);

/**
 * Compare a read-back wire against {@link REQUIRED_FUSES}.
 *
 * Returns the mismatches rather than throwing so the caller can report all of
 * them at once — a build that fails on the first wrong fuse hides the rest.
 */
export const findFuseMismatches = (wire: Partial<Record<FuseV1Options, FuseState>>): string[] => {
    const mismatches: string[] = [];
    for (const [fuse, enabled] of REQUIRED_FUSES) {
        const actual = wire[fuse];
        const expected = expectedState(enabled);
        if (actual !== expected) {
            mismatches.push(
                `${FuseV1Options[fuse]}: expected ${FuseState[expected]}, got ${actual === undefined ? 'nothing' : FuseState[actual]}`
            );
        }
    }
    return mismatches;
};

export const afterPack = async (context: AfterPackContext): Promise<void> => {
    const binaryPath = resolveElectronBinaryPath(context);

    await flipFuses(binaryPath, {
        version: FuseVersion.V1,
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: true,
        [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
        [FuseV1Options.EnableCookieEncryption]: true,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    });

    const wire = await getCurrentFuseWire(binaryPath);
    const mismatches = findFuseMismatches(wire);
    if (mismatches.length > 0) {
        throw new Error(`Electron fuses were not applied to ${binaryPath}: ${mismatches.join('; ')}`);
    }

    console.log(
        `[fuses] verified on ${binaryPath}: ${[...REQUIRED_FUSES]
            .map(([fuse, enabled]) => `${FuseV1Options[fuse]}=${String(enabled)}`)
            .join(' ')}`
    );
};
