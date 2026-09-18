#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fileSha256, wasmReleaseInventoryContract } from './checkReleaseInventory.ts';
import { fail } from './prContract.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';
import { wasmArtifacts, type WasmManifest } from './wasm-artifacts.ts';

export const RELEASE_INVENTORY_PATH = 'release/open-source-inventory.json';
const WASM_SURFACE_ID = 'project-wasm';
const { hashCrateClosure, readManifest } = wasmArtifacts;
const MANIFEST_SNAPSHOT_PATH = 'public/wasm/manifest.json';

type InventorySurface = Record<string, unknown>;
type ExpectedSurface = Record<string, unknown>;

type ReleaseInventory = {
    surfaces: InventorySurface[];
    snapshots: { path: string; sha256: string }[];
};

export type WasmRestampPlan = {
    surfaceFieldChanges: string[];
    snapshotSha?: { path: string; from: string; to: string };
};

function describeField(field: string, from: unknown, to: unknown): string {
    const render = (value: unknown): string => (Array.isArray(value) ? value.join(', ') : JSON.stringify(value));
    return `project-wasm ${field}: ${render(from)} -> ${render(to)}`;
}

/** The exact entries a restamp would move, or `undefined` when the inventory already matches. */
export function wasmRestampPlan(
    recordedSurface: InventorySurface | undefined,
    expected: ExpectedSurface,
    recordedSnapshot: { path: string; sha256: string } | undefined,
    expectedManifestSha256: string
): WasmRestampPlan | undefined {
    const surfaceFieldChanges: string[] = [];
    if (recordedSurface === undefined) {
        for (const [field, value] of Object.entries(expected)) {
            surfaceFieldChanges.push(describeField(field, undefined, value));
        }
    } else {
        for (const [field, value] of Object.entries(expected)) {
            const recorded = recordedSurface[field];
            let same: boolean;
            if (Array.isArray(recorded)) {
                same =
                    Array.isArray(value) &&
                    recorded.length === value.length &&
                    recorded.every((entry, i) => entry === value[i]);
            } else {
                same = recorded === value;
            }
            if (!same) {
                surfaceFieldChanges.push(describeField(field, recorded, value));
            }
        }
    }
    let snapshotSha: WasmRestampPlan['snapshotSha'];
    if (recordedSnapshot !== undefined && recordedSnapshot.sha256 !== expectedManifestSha256) {
        snapshotSha = { path: MANIFEST_SNAPSHOT_PATH, from: recordedSnapshot.sha256, to: expectedManifestSha256 };
    }
    if (surfaceFieldChanges.length === 0 && snapshotSha === undefined) {
        return undefined;
    }
    const plan: WasmRestampPlan = { surfaceFieldChanges };
    if (snapshotSha !== undefined) {
        plan.snapshotSha = snapshotSha;
    }
    return plan;
}

/**
 * The deliberate part stays deliberate: this command restamps only a tree whose committed
 * artifacts were genuinely rebuilt. A crate-source hash that moved without its package's
 * rebuild is a release-surface change nobody accepted, so it refuses and names the package.
 */
export function assertCommittedArtifactsAreFresh(manifest: WasmManifest): void {
    for (const [id, entry] of Object.entries(manifest.packages)) {
        if (hashCrateClosure(entry.crate) !== entry.crateSourceHash) {
            fail(
                `crate sources of ${id} (${entry.crate}) moved without a rebuild; run ` +
                    `${wasmRebuildCommand(id)} before restamping the inventory`
            );
        }
    }
}

/**
 * The exact rebuild command for a package id. The build script cannot be derived from the id
 * (`daw-dsp` builds via `wasm:dsp`, `daw-wasm-decoder` via `wasm:decoder`), so it comes from the
 * package spec rather than a guessed `wasm:*` wildcard.
 */
function wasmRebuildCommand(id: string): string {
    const spec = wasmArtifacts.packages.find((candidate) => candidate.id === id);
    if (spec === undefined) {
        throw new Error(`No wasm package spec declares the build script for ${id}`);
    }
    return `\`pnpm ${spec.buildScript} && pnpm wasm:manifest\``;
}

/**
 * Apply a plan in place and render the inventory's canonical serialization (4-indent, trailing
 * newline — byte-identical in style to restampDependencyBump), so a spec can pin exactly what a
 * write moves without touching a committed tree.
 */
export function applyWasmRestamp(
    inventory: ReleaseInventory,
    recordedSurface: InventorySurface,
    recordedSnapshot: { path: string; sha256: string },
    expected: ExpectedSurface,
    plan: WasmRestampPlan
): string {
    for (const [field, value] of Object.entries(expected)) {
        recordedSurface[field] = value;
    }
    if (plan.snapshotSha !== undefined) {
        recordedSnapshot.sha256 = plan.snapshotSha.to;
    }
    return `${JSON.stringify(inventory, null, 4)}\n`;
}

export type WasmRestampOptions = {
    /** The committed manifest to judge and restamp against; defaults to the repository's own. */
    manifest?: WasmManifest;
};

/**
 * Restamp the project-wasm surface and the manifest snapshot in `root`'s release inventory, after
 * refusing any tree whose committed artifacts are not fresh. `root` is injectable so a spec can
 * exercise the drift and refusal paths against a fixture without touching the release file.
 */
export function restampWasmInventory(root: string, options: WasmRestampOptions = {}): void {
    const manifest = options.manifest ?? readManifest();
    assertCommittedArtifactsAreFresh(manifest);
    const expected = wasmReleaseInventoryContract(root, manifest);
    const inventoryPath = resolve(root, RELEASE_INVENTORY_PATH);
    const inventory = parseJsonWithUniqueKeys<ReleaseInventory>(readFileSync(inventoryPath, 'utf8'), inventoryPath);
    const recordedSurface = inventory.surfaces.find((surface) => surface.id === WASM_SURFACE_ID);
    if (recordedSurface === undefined) {
        fail('project-wasm surface is absent from the inventory; surface shape changes need a person');
    }
    const recordedSnapshot = inventory.snapshots.find((entry) => entry.path === MANIFEST_SNAPSHOT_PATH);
    if (recordedSnapshot === undefined) {
        fail('manifest snapshot entry is absent from the inventory; surface shape changes need a person');
    }
    const plan = wasmRestampPlan(
        recordedSurface,
        expected,
        recordedSnapshot,
        fileSha256(resolve(root, MANIFEST_SNAPSHOT_PATH))
    );
    if (plan === undefined) {
        console.log('release inventory already current for the wasm surface');
        return;
    }
    for (const change of plan.surfaceFieldChanges) {
        console.log(change);
    }
    if (plan.snapshotSha !== undefined) {
        console.log(`snapshot ${plan.snapshotSha.path}: ${plan.snapshotSha.from} -> ${plan.snapshotSha.to}`);
    }
    writeFileSync(
        inventoryPath,
        applyWasmRestamp(inventory, recordedSurface, recordedSnapshot, expected, plan),
        'utf8'
    );
    console.log(`restamped ${RELEASE_INVENTORY_PATH}; verify with pnpm test:release-inventory`);
}

function run(root: string): void {
    restampWasmInventory(root);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    run(process.cwd());
}
