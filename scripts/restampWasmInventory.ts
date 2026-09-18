#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

import { fileSha256, wasmReleaseInventoryContract } from './checkReleaseInventory.ts';
import { fail } from './prContract.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';
import { wasmArtifacts } from './wasm-artifacts.ts';

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
function assertCommittedArtifactsAreFresh(): void {
    const manifest = readManifest();
    for (const [id, entry] of Object.entries(manifest.packages)) {
        if (hashCrateClosure(entry.crate) !== entry.crateSourceHash) {
            fail(
                `crate sources of ${id} (${entry.crate}) moved without a rebuild; run its wasm:* script and ` +
                    'pnpm wasm:manifest before restamping the inventory'
            );
        }
    }
}

function run(): void {
    assertCommittedArtifactsAreFresh();
    const root = process.cwd();
    const manifest = readManifest();
    const expected = wasmReleaseInventoryContract(root, manifest);
    const inventoryPath = `${root}/${RELEASE_INVENTORY_PATH}`;
    const inventory = parseJsonWithUniqueKeys<ReleaseInventory>(readFileSync(inventoryPath, 'utf8'), inventoryPath);
    const recordedSurface = inventory.surfaces.find((surface) => surface.id === WASM_SURFACE_ID);
    const recordedSnapshot = inventory.snapshots.find((entry) => entry.path === MANIFEST_SNAPSHOT_PATH);
    const plan = wasmRestampPlan(
        recordedSurface,
        expected,
        recordedSnapshot,
        fileSha256(`${root}/${MANIFEST_SNAPSHOT_PATH}`)
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
    for (const [field, value] of Object.entries(expected)) {
        if (recordedSurface !== undefined) {
            recordedSurface[field] = value;
        }
    }
    if (recordedSurface === undefined) {
        inventory.surfaces.push({ id: WASM_SURFACE_ID, ...expected });
    }
    if (recordedSnapshot !== undefined && plan.snapshotSha !== undefined) {
        recordedSnapshot.sha256 = plan.snapshotSha.to;
    }
    writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 4)}\n`, 'utf8');
    console.log(`restamped ${RELEASE_INVENTORY_PATH}; verify with pnpm test:release-inventory`);
}

run();
