import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
    assertGrandBouleReleaseInventory,
    GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS,
    GRAND_BOULE_RELEASE_REGISTRY,
    grandBouleReleaseInventoryContract,
} from '../checkReleaseInventory.ts';
import { UNRESTAMPED_DIGEST_CLASSES } from '../restampDependencyBump.ts';
import {
    applyTrackedSetRestamp,
    assertTrackedSetChangesCommitted,
    RELEASE_INVENTORY_PATH,
    restampTrackedSetInventory,
    trackedSetRestampPlan,
} from '../restampTrackedSetInventory.ts';
import { parseJsonWithUniqueKeys } from '../strictJson.ts';

const RESTAMP_SCRIPT_PATH = join(import.meta.dirname, '..', 'restampTrackedSetInventory.ts');
const STALE_SHA256 = 'c'.repeat(64);
const STALE_LABEL = GRAND_BOULE_RELEASE_REGISTRY.boundaries[0]!.digestLabel;

const fixtureRoots: string[] = [];

afterEach(() => {
    for (const root of fixtureRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

/**
 * Every file the checker's registry tracks for a Grand Boule tracked-set digest, with the provider
 * policy symlinks committed as canonical symlinks. Content is arbitrary: the digest hashes bytes,
 * not Rust or TypeScript semantics, and no other admission check runs in this spec.
 */
const TRACKED_SET_FILES: ReadonlyArray<readonly [string, string]> = [
    ['crates/daw-dsp/src/grand_boule/mod.rs', 'fixture native rust'],
    ['.agents/decisions/0036-readmit-grand-boule.md', 'fixture admission decision'],
    ['src/modules/Arrangement/models/PluginDescriptors/GrandBouleDescriptor.ts', 'fixture discovery descriptor'],
    ['src/modules/Arrangement/useCases/preset/sidebarInstrumentPresets.ts', 'fixture presets'],
    ['src/modules/ContentBrowser/presentations/views/Sidebar/InstrumentsTab.tsx', 'fixture tab'],
    ['src/infra/release/deviceReleaseAdmission.ts', 'fixture admission'],
    ['src/modules/AudioEngine/repositories/deviceStrategy/nativeDspDeviceFactories.ts', 'fixture factories'],
    ['src/modules/AudioEngine/repositories/deviceStrategy/unrenderableCatalogDeviceTypes.ts', 'fixture types'],
    ['src/utils/nativeDspDeviceTypes.ts', 'fixture native types'],
    ['src/modules/AudioEngine/engine/GrandBouleNode.ts', 'fixture node'],
    ['src/modules/AudioEngine/engine/wasmDeviceRegistry.ts', 'fixture wasm registry'],
    ['src/modules/AudioEngine/models/AudioEngineState.ts', 'fixture state'],
    ['src/modules/AudioEngine/models/GrandBouleRingProtocol.ts', 'fixture ring'],
    ['src/modules/AudioEngine/repositories/createWebAudioEngine.ts', 'fixture engine'],
    ['src/modules/AudioEngine/workers/grandBouleEngineWorker.ts', 'fixture worker'],
    ['src/modules/AudioEngine/worklets/grandBouleEngineCore.ts', 'fixture worklet'],
    ['src/modules/Transport/useCases/scheduling/scheduleMidiNotes.ts', 'fixture scheduling'],
    ['src/modules/GrandBoule/models/GrandBouleConfig.ts', 'fixture config'],
    ['src/modules/Command/useCases/versionedCommandArgumentKeys.ts', 'fixture command keys'],
    ['src/modules/Arrangement/useCases/index.ts', 'fixture arrangement'],
    ['src/modules/Arrangement/useCases/device/setDeviceState.ts', 'fixture device state'],
    ['src/app/composeGrandBoule.ts', 'fixture compose'],
    ['src/app/getProductionCommandHandlerMaps.ts', 'fixture handler maps'],
    ['src/utils/handlerContract.ts', 'fixture handler contract'],
    ['src/modules/GrandBoule/AGENTS.md', 'fixture module guidance'],
    ['src/app/prepareOfflineDeviceSetup.ts', 'fixture offline setup'],
    ['src/modules/AudioEngine/useCases/buildDeviceChain.ts', 'fixture device chain'],
    ['src/modules/GrandBoule/useCases/prepareOfflineGrandBoule.ts', 'fixture offline composition'],
    ['crates/daw-dsp/benches/quantum.rs', 'fixture quantum bench'],
    ['crates/daw-dsp/benches/wasm/deviceRecipes.js', 'fixture recipes'],
    ['crates/daw-dsp/benches/wasm/quantumCostProcessor.js', 'fixture cost processor'],
    ['crates/daw-dsp/benches/wasm/run.mjs', 'fixture runner'],
    ['scripts/quantumMeasurementCalibration.ts', 'fixture calibration'],
    ['crates/daw-dsp/benches/wasm/measurementCensus.mjs', 'fixture census'],
    ['crates/daw-dsp/benches/wasm/measurementCensus.d.mts', 'fixture census declarations'],
    ['crates/daw-dsp/benches/wasm/renderTable.mjs', 'fixture render table'],
    ['crates/daw-dsp/benches/wasm/renderTable.d.mts', 'fixture render table declarations'],
    ['crates/daw-dsp/benches/quantum-cost-table.json', '{}'],
    ['crates/daw-dsp/benches/quantum-cost-table.md', 'fixture cost table'],
    ['crates/daw-dsp/tests/quantum_bench_census.rs', 'fixture census test'],
    ['scripts/checkReleaseInventory.ts', 'fixture checker'],
];

function writeGrandBouleTrackedSetFixture(root: string): void {
    for (const [path, contents] of TRACKED_SET_FILES) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), contents);
    }
    for (const path of GRAND_BOULE_PROVIDER_POLICY_SYMLINK_PATHS) {
        const linkPath = join(root, path);
        rmSync(linkPath, { force: true });
        symlinkSync('AGENTS.md', linkPath);
    }
    execFileSync('git', ['init', '--quiet'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync(
        'git',
        ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'source'],
        { cwd: root }
    );
}

function createFixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'restamp-tracked-set-'));
    fixtureRoots.push(root);
    writeGrandBouleTrackedSetFixture(root);
    return root;
}

type InventorySurface = { id: string; digests: string[] } & Record<string, unknown>;
type RecordedInventory = { surfaces: InventorySurface[] };

function trackedSetLabel(entry: string): string {
    return entry.slice(entry.lastIndexOf(':') + 1);
}

/**
 * An inventory whose grand-boule surface carries the checker's own contract with one boundary's
 * digest staled, so a test can drive the real drift path against a fixture.
 */
function writeDriftedInventory(root: string, staleLabel: string): void {
    const contract = grandBouleReleaseInventoryContract(root);
    const digests = contract.digests.map((entry) =>
        trackedSetLabel(entry) === staleLabel ? `tracked-set-sha256:${STALE_SHA256}:${staleLabel}` : entry
    );
    const surface = { id: 'grand-boule', ...contract, digests };
    mkdirSync(dirname(join(root, RELEASE_INVENTORY_PATH)), { recursive: true });
    writeFileSync(join(root, RELEASE_INVENTORY_PATH), `${JSON.stringify({ surfaces: [surface] }, null, 4)}\n`, 'utf8');
}

function readInventory(root: string): RecordedInventory {
    return parseJsonWithUniqueKeys<RecordedInventory>(
        readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8'),
        RELEASE_INVENTORY_PATH
    );
}

function grandBouleSurface(root: string): InventorySurface {
    const surface = readInventory(root).surfaces.find((entry) => entry.id === 'grand-boule');
    if (surface === undefined) {
        throw new Error('expected a grand-boule surface in the fixture inventory');
    }
    return surface;
}

/** Every tracked file under `root`, so a test can require an import or a command to leave them untouched. */
function filesUnder(root: string): Record<string, string> {
    const files: Record<string, string> = {};
    const visit = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            if (entry.name === '.git') {
                continue;
            }
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(path);
            } else {
                files[relative(root, path)] = readFileSync(path, 'utf8');
            }
        }
    };
    visit(root);
    return files;
}

function thrownMessage(action: () => void): string {
    try {
        action();
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('expected the action to throw');
}

describe('tracked-set restamp plan', () => {
    it('reports nothing when every recorded digest already matches', () => {
        const expected = [
            `tracked-set-sha256:${'a'.repeat(64)}:grand-boule-native-rust`,
            `tracked-set-sha256:${'b'.repeat(64)}:grand-boule-release-proof`,
        ];
        expect(trackedSetRestampPlan(expected, expected)).toBeUndefined();
    });

    it('plans exactly the drifted digest, paired by label, not by position', () => {
        const nativeRust = `tracked-set-sha256:${'a'.repeat(64)}:grand-boule-native-rust`;
        const releaseProof = `tracked-set-sha256:${'b'.repeat(64)}:grand-boule-release-proof`;
        const expected = [nativeRust, releaseProof];
        // Reordered relative to the registry so a positional pairing would pair release-proof with
        // the native-rust digest and miss the real drift entirely.
        const recorded = [releaseProof, `tracked-set-sha256:${STALE_SHA256}:grand-boule-native-rust`];
        expect(trackedSetRestampPlan(recorded, expected)).toEqual({
            digestChanges: [
                {
                    label: 'grand-boule-native-rust',
                    from: recorded[1],
                    to: nativeRust,
                },
            ],
        });
    });

    it('plans every drifted digest independently', () => {
        const expected = [
            `tracked-set-sha256:${'a'.repeat(64)}:grand-boule-native-rust`,
            `tracked-set-sha256:${'b'.repeat(64)}:grand-boule-release-proof`,
        ];
        const recorded = [
            `tracked-set-sha256:${STALE_SHA256}:grand-boule-native-rust`,
            `tracked-set-sha256:${STALE_SHA256}:grand-boule-release-proof`,
        ];
        expect(trackedSetRestampPlan(recorded, expected)?.digestChanges).toHaveLength(2);
    });

    it('leaves a recorded label the registry no longer produces out of the plan', () => {
        const expected = [`tracked-set-sha256:${'a'.repeat(64)}:grand-boule-native-rust`];
        const recorded = [
            `tracked-set-sha256:${'a'.repeat(64)}:grand-boule-native-rust`,
            `tracked-set-sha256:${STALE_SHA256}:retired-boundary`,
        ];
        expect(trackedSetRestampPlan(recorded, expected)).toBeUndefined();
    });
});

describe('tracked-set restamp write and refusals', () => {
    it('writes only the drifted entries and renders canonical serialization', () => {
        const nativeRust = `tracked-set-sha256:${'a'.repeat(64)}:grand-boule-native-rust`;
        const releaseProof = `tracked-set-sha256:${'b'.repeat(64)}:grand-boule-release-proof`;
        const retired = `tracked-set-sha256:${STALE_SHA256}:retired-boundary`;
        const expected = [nativeRust, releaseProof];
        // The recorded array carries a retired label the registry no longer produces; rewriting the
        // whole array would drop it, but a restamp must move only the drifted entries.
        const recorded = [`tracked-set-sha256:${STALE_SHA256}:grand-boule-native-rust`, releaseProof, retired];
        const inventory: RecordedInventory = {
            surfaces: [{ id: 'grand-boule', kind: 'project-source', digests: [...recorded] }],
        };
        const plan = trackedSetRestampPlan(recorded, expected);
        if (plan === undefined) {
            throw new Error('expected a plan');
        }
        const written = applyTrackedSetRestamp(inventory, inventory.surfaces[0]!, expected, plan);
        const parsed = parseJsonWithUniqueKeys<RecordedInventory>(written, 'written inventory');
        expect(parsed.surfaces[0]?.digests).toEqual([nativeRust, releaseProof, retired]);
        expect(written.endsWith('}\n')).toBe(true);
        expect(written).toContain('\n    "surfaces"');
    });

    it('restamps a drifted fixture to exactly what the checker computes, and the checker accepts it', () => {
        const root = createFixture();
        const staleLabel = STALE_LABEL;
        writeDriftedInventory(root, staleLabel);

        const output = execFileSync('node', [RESTAMP_SCRIPT_PATH], { cwd: root, encoding: 'utf8' });

        const expected = grandBouleReleaseInventoryContract(root).digests;
        expect(grandBouleSurface(root).digests).toEqual(expected);
        expect(() => assertGrandBouleReleaseInventory(root, grandBouleSurface(root))).not.toThrow();
        expect(output).toContain(`grand-boule ${staleLabel}:`);
        expect(output).toContain('restamped release/open-source-inventory.json');
    });

    it('refuses an uncommitted tracked-set change before writing, naming the file', () => {
        const root = createFixture();
        const staleLabel = STALE_LABEL;
        writeDriftedInventory(root, staleLabel);
        const before = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');
        writeFileSync(join(root, 'crates/daw-dsp/benches/wasm/renderTable.mjs'), 'uncommitted drift\n');

        const message = thrownMessage(() => restampTrackedSetInventory(root));

        expect(message).toContain('uncommitted changes');
        expect(message).toContain('crates/daw-dsp/benches/wasm/renderTable.mjs');
        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(before);
    });

    it('refuses a staged deletion of a tracked-set member before writing, naming the file', () => {
        const root = createFixture();
        writeDriftedInventory(root, STALE_LABEL);
        const before = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');
        execFileSync('git', ['rm', '-q', 'crates/daw-dsp/benches/quantum-cost-table.json'], { cwd: root });

        const message = thrownMessage(() => restampTrackedSetInventory(root));

        expect(message).toContain('uncommitted changes');
        expect(message).toContain('crates/daw-dsp/benches/quantum-cost-table.json');
        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(before);
    });

    it('refuses an untracked member inside the set before writing, naming the file', () => {
        const root = createFixture();
        writeDriftedInventory(root, STALE_LABEL);
        const before = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');
        writeFileSync(join(root, 'crates/daw-dsp/src/grand_boule/untracked.rs'), 'untracked member\n');

        const message = thrownMessage(() => restampTrackedSetInventory(root));

        expect(message).toContain('uncommitted changes');
        expect(message).toContain('crates/daw-dsp/src/grand_boule/untracked.rs');
        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(before);
    });

    it('refuses a staged addition inside the set before writing, naming the file', () => {
        const root = createFixture();
        writeDriftedInventory(root, STALE_LABEL);
        const before = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');
        writeFileSync(join(root, 'crates/daw-dsp/src/grand_boule/added.rs'), 'added member\n');
        execFileSync('git', ['add', 'crates/daw-dsp/src/grand_boule/added.rs'], { cwd: root });

        const message = thrownMessage(() => restampTrackedSetInventory(root));

        expect(message).toContain('uncommitted changes');
        expect(message).toContain('crates/daw-dsp/src/grand_boule/added.rs');
        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(before);
    });

    it('refuses a rename inside the set before writing, naming the new path', () => {
        const root = createFixture();
        writeDriftedInventory(root, STALE_LABEL);
        const before = readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8');
        execFileSync(
            'git',
            ['mv', 'crates/daw-dsp/src/grand_boule/mod.rs', 'crates/daw-dsp/src/grand_boule/renamed_mod.rs'],
            { cwd: root }
        );

        const message = thrownMessage(() => restampTrackedSetInventory(root));

        expect(message).toContain('uncommitted changes');
        expect(message).toContain('crates/daw-dsp/src/grand_boule/renamed_mod.rs');
        expect(readFileSync(join(root, RELEASE_INVENTORY_PATH), 'utf8')).toBe(before);
    });

    it('accepts a clean committed tree through the gate', () => {
        const root = createFixture();
        expect(() => assertTrackedSetChangesCommitted(root)).not.toThrow();
    });

    it('refuses an inventory with no grand-boule surface, leaving every file untouched', () => {
        const root = createFixture();
        mkdirSync(join(root, 'release'), { recursive: true });
        writeFileSync(join(root, RELEASE_INVENTORY_PATH), `${JSON.stringify({ surfaces: [] }, null, 4)}\n`, 'utf8');
        const before = filesUnder(root);

        const message = thrownMessage(() => restampTrackedSetInventory(root));

        expect(message).toContain('grand-boule surface is absent from the inventory');
        expect(filesUnder(root)).toEqual(before);
    });

    it('the command reports a current inventory on a fresh committed tree', () => {
        const output = execFileSync('node', [RESTAMP_SCRIPT_PATH], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });
        expect(output).toContain('already current');
    });
});

describe('tracked-set restamp entry point', () => {
    it('importing the module leaves a deliberately drifted tree untouched', () => {
        const root = createFixture();
        writeDriftedInventory(root, STALE_LABEL);
        const before = filesUnder(root);
        const moduleUrl = pathToFileURL(RESTAMP_SCRIPT_PATH).href;
        execFileSync(
            'node',
            ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)})`, 'not-this-script.ts'],
            {
                cwd: root,
                encoding: 'utf8',
            }
        );
        expect(filesUnder(root)).toEqual(before);
    });

    it('is reachable as pnpm release:restamp:tracked-set', () => {
        const manifest = parseJsonWithUniqueKeys<{ scripts: Record<string, string> }>(
            readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
            'package.json'
        );
        expect(manifest.scripts['release:restamp:tracked-set']).toBe('node scripts/restampTrackedSetInventory.ts');
    });

    it('is listed in the AGENTS.md checks table beside the restamp rows', () => {
        const agents = readFileSync(join(import.meta.dirname, '../../AGENTS.md'), 'utf8');
        expect(agents).toMatch(/^\| Restamp a tracked set +\| `pnpm release:restamp:tracked-set` +\|$/mu);
    });

    it('release:restamp points a drifted tracked set at the tracked-set restamp command', () => {
        expect(UNRESTAMPED_DIGEST_CLASSES).toContain('pnpm release:restamp:tracked-set');
    });
});
