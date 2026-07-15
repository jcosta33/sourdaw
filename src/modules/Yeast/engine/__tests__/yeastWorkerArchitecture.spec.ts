import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const yeastRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function collectTypeScriptSources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
            return collectTypeScriptSources(path);
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
            return [];
        }
        return [readFileSync(path, 'utf8')];
    });
}

describe('Yeast runtime architecture', () => {
    it('keeps the MIDI rack out of AudioWorklet render-thread APIs', () => {
        const source = collectTypeScriptSources(yeastRoot).join('\n');

        expect(source).not.toMatch(/AudioWorkletNode|AudioWorkletProcessor|registerProcessor|audioWorklet|addModule/);
        expect(source).not.toMatch(/currentFrame/);
    });

    it('has a dedicated Worker client and entrypoint', () => {
        const workerClient = join(yeastRoot, 'engine', 'YeastWorkerClient.ts');
        const workerEntrypoint = join(yeastRoot, 'workers', 'yeastWorker.ts');

        expect(existsSync(workerClient)).toBe(true);
        expect(existsSync(workerEntrypoint)).toBe(true);
        expect(readFileSync(workerClient, 'utf8')).toMatch(/new Worker/);
        expect(readFileSync(workerEntrypoint, 'utf8')).toMatch(/self\.onmessage/);
    });
});
