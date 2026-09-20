/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Offline context preparation census — SPEC-offline-live-collapse AC-1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **What this asserts.** Every offline render that builds a device strip
 * prepares its context through the one shared `prepareOfflineContext`, and that
 * function registers a module for every device type whose offline construction
 * needs one no device factory registers.
 *
 * **Why it is a census and not three hand-written assertions.** Both halves are
 * enumerated, and from *two independently sourced places* — which is the whole
 * difference between a check and a table compared against itself:
 *
 *   population    the device types in `OUT_OF_BAND_OFFLINE_MODULE_DEVICE_TYPES`,
 *                 read off the prepare module itself.
 *   expectation   every render-context constructor whose relative import graph
 *                 reaches an offline strip builder. Neither list is written in
 *                 this file, so extracting construction and strip building into
 *                 separate files cannot make the census lose that route.
 *
 * **Why source plus the import graph.** A fourth render path would construct a
 * context and reach a strip builder, possibly through an extracted backend.
 * Following relative imports catches that route before it ships. The named
 * paths below are only a non-vacuity floor; they do not bound the discovered
 * population, and every additional discovered route receives the same prepare
 * assertion.
 *
 * **Limit.** This proves the module is *registered*, not that the resulting
 * node renders the same audio as live. That is AC-0's null, which this spec
 * does not carry.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { OUT_OF_BAND_OFFLINE_MODULE_DEVICE_TYPES, prepareOfflineContext } from '../prepareOfflineContext';

const SRC_ROOT = join(import.meta.dirname, '../../../../..');

function collectTypeScriptFiles(directory: string, into: string[]): string[] {
    for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
            if (entry === '__tests__' || entry === 'node_modules') {
                continue;
            }
            collectTypeScriptFiles(path, into);
            continue;
        }
        if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.includes('.spec.')) {
            into.push(path);
        }
    }
    return into;
}

/**
 * Context constructors whose relative import graph reaches an offline strip
 * builder. The second condition is what separates a render from a utility context:
 * a decode context, a resampler and the 1-frame capability probe in
 * `createWebAudioEngine` all construct one and build no strip, so requiring a
 * worklet prepare of them would be requiring a module fetch for nothing.
 *
 * Deriving the predicate rather than listing exemptions is deliberate. An
 * exemption table here would have ten rows against three verdicts, and a census
 * whose reasoned exemptions outnumber its verdicts is an allow-list by another
 * name.
 */
const RELATIVE_IMPORT = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/g;
const TYPESCRIPT_RESOLUTION_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'] as const;

function resolveRelativeImport(importer: string, specifier: string): string | null {
    const base = resolve(dirname(importer), specifier);
    for (const suffix of TYPESCRIPT_RESOLUTION_SUFFIXES) {
        const candidate = `${base}${suffix}`;
        if (existsSync(candidate) && statSync(candidate).isFile() && !relative(SRC_ROOT, candidate).startsWith('..')) {
            return candidate;
        }
    }
    return null;
}

function collectRelativeImportGraph(entry: string): string[] {
    const visited = new Set<string>();
    const pending = [entry];
    while (pending.length > 0) {
        const path = pending.pop();
        if (!path || visited.has(path)) {
            continue;
        }
        visited.add(path);
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(RELATIVE_IMPORT)) {
            const dependency = resolveRelativeImport(path, match[1]);
            if (dependency && !visited.has(dependency)) {
                pending.push(dependency);
            }
        }
    }
    return [...visited];
}

type StripBuildingRenderRoute = {
    owner: string;
    files: string[];
};

function findStripBuildingRenderRoutes(): StripBuildingRenderRoute[] {
    const files = collectTypeScriptFiles(SRC_ROOT, []);
    const contextOwners = files.filter((path) => /\bnew\s+OfflineAudioContext\s*\(/.test(readFileSync(path, 'utf8')));
    const routes = contextOwners.map((path) => ({ owner: path, files: collectRelativeImportGraph(path) }));
    const buildsStrip = /\bcreateOffline(?:Track|Bus)Strip\s*\(/;
    const stripBuildingRoutes = routes.filter(({ files: routeFiles }) =>
        routeFiles.some((path) => buildsStrip.test(readFileSync(path, 'utf8')))
    );
    return stripBuildingRoutes.map(({ owner, files: routeFiles }) => ({
        owner: relative(SRC_ROOT, owner),
        files: routeFiles,
    }));
}

describe('offline context preparation census', () => {
    it('finds every render path that builds a strip on a context it constructed', () => {
        const renderRoutes = findStripBuildingRenderRoutes();
        const renderOwners = renderRoutes.map(({ owner }) => owner);

        // Pinned so the enumeration itself cannot go blind. A scan that matched
        // nothing would satisfy the per-file assertion below vacuously — the
        // failure mode ADR 0015's Context describes, where a census spent 41
        // commits comparing an empty extraction against an expectation.
        expect(renderRoutes.length).toBeGreaterThanOrEqual(3);
        expect(renderOwners).toEqual(
            expect.arrayContaining([
                'modules/AudioEngine/useCases/offlineRender/executeOfflineRender.ts',
                'modules/AudioEngine/useCases/exportStems.ts',
                'modules/AudioEngine/useCases/offlineRender/renderTrackSubgraphOffline.ts',
            ])
        );
    });

    it('routes every one of them through the shared prepare', () => {
        // The *call*, not the mention. Matching the bare identifier passes on a
        // file whose call was deleted and whose import survived — which is what
        // the mutation for this assertion actually produces, and it left the
        // first draft of this census green over a freeze path that prepared
        // nothing.
        const callsPrepare = /\bprepareOfflineContext\s*\(/;
        const offenders = findStripBuildingRenderRoutes()
            .filter(({ files: routeFiles }) =>
                routeFiles.every((path) => !callsPrepare.test(readFileSync(path, 'utf8')))
            )
            .map(({ owner }) => owner);

        expect(
            offenders,
            `these offline renders build strips on a context nothing prepared, so every device whose ` +
                `module no factory registers degrades silently: ${offenders.join(', ')}`
        ).toEqual([]);
    });

    it('registers a module for every device type declared to need one', async () => {
        const registered: string[] = [];
        const offlineCtx = {
            audioWorklet: {
                addModule: (specifier: string) => {
                    registered.push(specifier);
                    return Promise.resolve();
                },
            },
        } as unknown as OfflineAudioContext;
        const compressor = { id: 'sc-1', type: 'builtin-sidechain-compressor' };

        await prepareOfflineContext({
            offlineCtx,
            tracks: OUT_OF_BAND_OFFLINE_MODULE_DEVICE_TYPES.map((type) => ({
                devices: [{ type, bypassed: false }],
            })),
            sidechainTargetDevices: new Set([compressor]),
        });

        // One module per declared type. Deleting a prepare from
        // `prepareOfflineContext` drops the count and reds this; adding a type
        // to the registry without a prepare reds it the same way.
        expect(registered).toHaveLength(OUT_OF_BAND_OFFLINE_MODULE_DEVICE_TYPES.length);
    });

    it('reports the degradation instead of swallowing it when a module fails to register', async () => {
        const onWarning = vi.fn();
        const offlineCtx = {
            audioWorklet: {
                addModule: () => Promise.reject(new Error('module fetch failed')),
            },
        } as unknown as OfflineAudioContext;

        await prepareOfflineContext({
            offlineCtx,
            tracks: [{ devices: [{ type: 'builtin-bitcrusher', bypassed: false }] }],
            sidechainTargetDevices: new Set([{ id: 'sc-1' }]),
            onWarning,
        });

        // Both degrade paths report. Before AC-1 the freeze path had no
        // `prepared` record at all, so `createSidechainCompressorFallback` had
        // no `onWarning` to reach and the substitution was invisible.
        expect(onWarning.mock.calls.map((call) => String(call[0]))).toEqual([
            expect.stringContaining('Sidechain processor unavailable'),
            expect.stringContaining('Bitcrusher rate reduction unavailable'),
        ]);
    });

    it('fetches nothing for a render whose tracks carry neither device', async () => {
        const registered: string[] = [];
        const offlineCtx = {
            audioWorklet: {
                addModule: (specifier: string) => {
                    registered.push(specifier);
                    return Promise.resolve();
                },
            },
        } as unknown as OfflineAudioContext;

        await prepareOfflineContext({
            offlineCtx,
            tracks: [{ devices: [{ type: 'builtin-gain', bypassed: false }] }],
            sidechainTargetDevices: new Set(),
        });

        expect(registered).toEqual([]);
    });

    it('skips the bitcrusher module when the only bitcrusher on the render is bypassed', async () => {
        const registered: string[] = [];
        const offlineCtx = {
            audioWorklet: {
                addModule: (specifier: string) => {
                    registered.push(specifier);
                    return Promise.resolve();
                },
            },
        } as unknown as OfflineAudioContext;

        await prepareOfflineContext({
            offlineCtx,
            tracks: [{ devices: [{ type: 'builtin-bitcrusher', bypassed: true }] }],
            sidechainTargetDevices: new Set(),
        });

        expect(registered).toEqual([]);
    });
});
