import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import {
    MIN_RENDER_TIMEOUT_MS,
    NATIVE_OFFLINE_RENDER_MAX_FRAMES,
    RENDER_TIMEOUT_MULTIPLIER,
    YIELD_EVERY_N_NOTES,
} from '../constants';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../../../../../../../');

const NATIVE_GRAPH_SOURCE = 'crates/sourdaw-native/src/commands/graph.rs';

/** The native render's own ceiling, read out of the source the addon compiles. */
function nativeOfflineRenderCeiling(): number {
    const source = readFileSync(join(REPO_ROOT, NATIVE_GRAPH_SOURCE), 'utf8');
    const expression = /^(?:pub(?:\([a-z]+\))? )?const MAX_OFFLINE_RENDER_FRAMES: usize = ([\d_ *]+);$/m.exec(source)?.[1];
    if (expression === undefined) {
        throw new Error(`${NATIVE_GRAPH_SOURCE} no longer declares MAX_OFFLINE_RENDER_FRAMES as a product`);
    }
    return expression
        .split('*')
        .map((factor) => Number(factor.trim().replaceAll('_', '')))
        .reduce((product, factor) => product * factor, 1);
}

describe('offlineRender/constants', () => {
    it('should export expected numeric guards', () => {
        expect(MIN_RENDER_TIMEOUT_MS).toBe(60_000);
        expect(RENDER_TIMEOUT_MULTIPLIER).toBe(10);
        expect(YIELD_EVERY_N_NOTES).toBe(200);
    });

    it('keeps the native frame ceiling equal to the one the native render enforces', () => {
        expect(NATIVE_OFFLINE_RENDER_MAX_FRAMES).toBe(nativeOfflineRenderCeiling());
    });
});
