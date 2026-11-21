import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { type PrefetchDependencies, prefetchKokoroFixtures } from '../prefetchKokoroFixtures.ts';

const text = 'pinned artifact bytes';
const body = new TextEncoder().encode(text);
const artifact = {
    name: 'model.onnx',
    url: 'https://example.test/model.onnx',
    size: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
};

function setup(options: { existing?: Uint8Array; responses: (() => Response)[] }) {
    const written = new Map<string, Uint8Array>();
    const fetched: string[] = [];
    const sleeps: number[] = [];
    const queue = [...options.responses];
    const dependencies: PrefetchDependencies = {
        fetch: (url) => {
            fetched.push(url);
            const next = queue.shift();
            return next ? Promise.resolve(next()) : Promise.reject(new Error('unexpected fetch'));
        },
        read: () => Promise.resolve(options.existing ?? null),
        write: (path, bytes) => {
            written.set(path, bytes);
        },
        sleep: (milliseconds) => {
            sleeps.push(milliseconds);
            return Promise.resolve();
        },
        log: () => undefined,
    };
    return { dependencies, written, fetched, sleeps };
}

function writtenText(written: Map<string, Uint8Array>): string | undefined {
    const bytes = written.get('/fixtures/model.onnx');
    return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
}

const ok = () => new Response(body);

describe('prefetchKokoroFixtures', () => {
    it('downloads and writes an artifact that matches its pin', async () => {
        const { dependencies, written, fetched } = setup({ responses: [ok] });
        await prefetchKokoroFixtures('/fixtures', [artifact], dependencies);
        expect(fetched).toEqual([artifact.url]);
        expect(writtenText(written)).toBe(text);
    });

    it('skips the download when the present file already matches its pin', async () => {
        const { dependencies, written, fetched } = setup({ existing: body, responses: [] });
        await prefetchKokoroFixtures('/fixtures', [artifact], dependencies);
        expect(fetched).toEqual([]);
        expect(written.size).toBe(0);
    });

    it('replaces a present file whose content does not match its pin', async () => {
        const { dependencies, written, fetched } = setup({
            existing: new TextEncoder().encode('stale artifact bytes'),
            responses: [ok],
        });
        await prefetchKokoroFixtures('/fixtures', [artifact], dependencies);
        expect(fetched).toEqual([artifact.url]);
        expect(writtenText(written)).toBe(text);
    });

    it('retries after a failed attempt and then succeeds', async () => {
        const { dependencies, written, fetched, sleeps } = setup({
            responses: [() => new Response(null, { status: 503 }), ok],
        });
        await prefetchKokoroFixtures('/fixtures', [artifact], dependencies);
        expect(fetched).toHaveLength(2);
        expect(sleeps).toHaveLength(1);
        expect(writtenText(written)).toBe(text);
    });

    it('refuses bytes whose sha256 differs from the pin and writes nothing', async () => {
        const wrong = new TextEncoder().encode('pinned artifact bytez');
        const { dependencies, written, fetched } = setup({
            responses: [0, 1, 2, 3].map(() => () => new Response(wrong)),
        });
        await expect(prefetchKokoroFixtures('/fixtures', [artifact], dependencies)).rejects.toThrow(
            'Could not fetch model.onnx after 4 attempts'
        );
        expect(fetched).toHaveLength(4);
        expect(written.size).toBe(0);
    });

    it('refuses bytes of the wrong length', async () => {
        const { dependencies, written } = setup({
            responses: [0, 1, 2, 3].map(() => () => new Response(body.slice(1))),
        });
        await expect(prefetchKokoroFixtures('/fixtures', [artifact], dependencies)).rejects.toThrow(
            'Could not fetch model.onnx'
        );
        expect(written.size).toBe(0);
    });
});
