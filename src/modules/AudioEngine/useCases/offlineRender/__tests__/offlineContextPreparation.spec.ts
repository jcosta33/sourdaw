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
 *   expectation   the set of render-context constructors, found by scanning
 *                 `src/` for `new OfflineAudioContext`. Neither list is written
 *                 in this file, so adding a fourth render path that skips the
 *                 prepare reds this without anyone remembering to update it.
 *
 * **Why the scan and not an import graph.** A fourth render path would import
 * `createOfflineTrackStrip` and construct its own context; only reading the
 * source catches it before it ships. The alternative — asserting a list of
 * three filenames — is the exact shape ADR 0015 rule 3 rejects, because the
 * list and the thing it describes would be the same edit.
 *
 * **Limit.** This proves the module is *registered*, not that the resulting
 * node renders the same audio as live. That is AC-0's null, which this spec
 * does not carry.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
 * Files that construct an `OfflineAudioContext` *and* build an offline strip on
 * it. The second condition is what separates a render from a utility context:
 * a decode context, a resampler and the 1-frame capability probe in
 * `createWebAudioEngine` all construct one and build no strip, so requiring a
 * worklet prepare of them would be requiring a module fetch for nothing.
 *
 * Deriving the predicate rather than listing exemptions is deliberate. An
 * exemption table here would have ten rows against three verdicts, and a census
 * whose reasoned exemptions outnumber its verdicts is an allow-list by another
 * name.
 */
function findStripBuildingRenderFiles(): string[] {
    const files = collectTypeScriptFiles(SRC_ROOT, []);
    return files
        .filter((path) => {
            const source = readFileSync(path, 'utf8');
            const constructsContext = source.includes('new OfflineAudioContext');
            const buildsStrip = source.includes('createOfflineTrackStrip') || source.includes('createOfflineBusStrip');
            return constructsContext && buildsStrip;
        })
        .map((path) => path.slice(SRC_ROOT.length + 1));
}

describe('offline context preparation census', () => {
    it('finds every render path that builds a strip on a context it constructed', () => {
        const renderFiles = findStripBuildingRenderFiles();

        // Pinned so the enumeration itself cannot go blind. A scan that matched
        // nothing would satisfy the per-file assertion below vacuously — the
        // failure mode ADR 0015's Context describes, where a census spent 41
        // commits comparing an empty extraction against an expectation.
        expect(renderFiles.length).toBeGreaterThanOrEqual(3);
        expect(renderFiles).toEqual(
            expect.arrayContaining([
                'modules/AudioEngine/useCases/renderOffline.ts',
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
        const offenders = findStripBuildingRenderFiles().filter(
            (relativePath) => !callsPrepare.test(readFileSync(join(SRC_ROOT, relativePath), 'utf8'))
        );

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
