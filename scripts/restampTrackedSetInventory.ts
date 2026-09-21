#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    GRAND_BOULE_RELEASE_REGISTRY,
    grandBouleReleaseInventoryContract,
    type ReleaseInventory,
} from './checkReleaseInventory.ts';
import { fail } from './prContract.ts';
import { parseJsonWithUniqueKeys } from './strictJson.ts';

export const RELEASE_INVENTORY_PATH = 'release/open-source-inventory.json';
const GRAND_BOULE_SURFACE_ID = 'grand-boule';

type TrackedSetDigestChange = { label: string; from: string; to: string };

export type TrackedSetRestampPlan = {
    digestChanges: TrackedSetDigestChange[];
};

function trackedSetDigestLabel(entry: string): string {
    return entry.slice(entry.lastIndexOf(':') + 1);
}

/** The tracked-set pathspecs the checker hashes, read from its own registry. */
function trackedSetPathspecs(): readonly string[] {
    return GRAND_BOULE_RELEASE_REGISTRY.boundaries.flatMap(({ gitPathspecs }) => [...gitPathspecs]);
}

/** The exact files a tracked-set digest hashes, resolved the way the checker resolves them. */
function trackedSetFiles(root: string): string[] {
    return execFileSync('git', ['ls-files', '-z', '--', ...trackedSetPathspecs()], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\0')
        .filter(Boolean)
        .sort();
}

function uncommittedTrackedSetFiles(root: string): string[] {
    const files = trackedSetFiles(root);
    if (files.length === 0) {
        return [];
    }
    return execFileSync('git', ['diff', 'HEAD', '--name-only', '--', ...files], {
        cwd: root,
        encoding: 'utf8',
    })
        .split('\n')
        .filter(Boolean);
}

/**
 * The deliberate part stays deliberate: a tracked-set digest is computed over the working tree, so
 * an uncommitted edit is drift nobody has accepted. Restamp only a tree whose tracked-set members
 * are committed — the change a person made must be represented in the tree before it is recorded.
 */
export function assertTrackedSetChangesCommitted(root: string): void {
    const changed = uncommittedTrackedSetFiles(root);
    if (changed.length > 0) {
        fail(
            `tracked-set members have uncommitted changes (${changed.join(', ')}); ` +
                'commit them before restamping the inventory'
        );
    }
}

/**
 * The exact digest entries a restamp would move, or `undefined` when every recorded entry already
 * matches the checker's computation. Only same-label drift is a restamp's to fix; a missing or
 * extra label is a surface shape change the checker names for a person.
 */
export function trackedSetRestampPlan(
    recordedDigests: readonly string[],
    expectedDigests: readonly string[]
): TrackedSetRestampPlan | undefined {
    const expectedByLabel = new Map(expectedDigests.map((entry) => [trackedSetDigestLabel(entry), entry]));
    const digestChanges: TrackedSetDigestChange[] = [];
    for (const recorded of recordedDigests) {
        const label = trackedSetDigestLabel(recorded);
        const expected = expectedByLabel.get(label);
        if (expected !== undefined && recorded !== expected) {
            digestChanges.push({ label, from: recorded, to: expected });
        }
    }
    return digestChanges.length === 0 ? undefined : { digestChanges };
}

/**
 * Apply a plan in place and render the inventory's canonical serialization (4-indent, trailing
 * newline — byte-identical in style to the sibling restamp commands), so a spec can pin exactly
 * what a write moves without touching a committed tree.
 */
export function applyTrackedSetRestamp(
    inventory: unknown,
    recordedSurface: { digests: string[] },
    expectedDigests: readonly string[],
    plan: TrackedSetRestampPlan
): string {
    const expectedByLabel = new Map(expectedDigests.map((entry) => [trackedSetDigestLabel(entry), entry]));
    for (const change of plan.digestChanges) {
        const index = recordedSurface.digests.findIndex((entry) => trackedSetDigestLabel(entry) === change.label);
        const expected = expectedByLabel.get(change.label);
        if (index >= 0 && expected !== undefined) {
            recordedSurface.digests[index] = expected;
        }
    }
    return `${JSON.stringify(inventory, null, 4)}\n`;
}

/**
 * Restamp the grand-boule surface's tracked-set digests in `root`'s release inventory, after
 * refusing any tree whose tracked-set members carry uncommitted changes. The new value is always
 * the checker's own computation, never a second derivation. `root` is injectable so a spec can
 * exercise the drift and refusal paths against a fixture without touching the release file.
 */
export function restampTrackedSetInventory(root: string): void {
    assertTrackedSetChangesCommitted(root);
    const expected = grandBouleReleaseInventoryContract(root);
    const inventoryPath = resolve(root, RELEASE_INVENTORY_PATH);
    const inventory = parseJsonWithUniqueKeys<ReleaseInventory>(readFileSync(inventoryPath, 'utf8'), inventoryPath);
    const recordedSurface = inventory.surfaces.find((surface) => surface.id === GRAND_BOULE_SURFACE_ID);
    if (recordedSurface === undefined) {
        fail('grand-boule surface is absent from the inventory; surface shape changes need a person');
    }
    const plan = trackedSetRestampPlan(recordedSurface.digests, expected.digests);
    if (plan === undefined) {
        console.log('release inventory already current for the grand-boule tracked sets');
        return;
    }
    for (const change of plan.digestChanges) {
        console.log(`grand-boule ${change.label}: ${change.from} -> ${change.to}`);
    }
    writeFileSync(inventoryPath, applyTrackedSetRestamp(inventory, recordedSurface, expected.digests, plan), 'utf8');
    console.log(`restamped ${RELEASE_INVENTORY_PATH}; verify with pnpm test:release-inventory`);
}

function run(root: string): void {
    restampTrackedSetInventory(root);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === new URL(`file://${resolve(entry)}`).href) {
    run(process.cwd());
}
