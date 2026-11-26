// @vitest-environment node
import { change, from, save, saveIncremental } from '@automerge/automerge';
import { describe, expect, it } from 'vitest';

import { readCrumbsSnapshot } from '../desktopCrumbsSamplerSnapshot.ts';

import type { Page } from 'playwright';

function pageFor(raw: [string, number[]][]): Page {
    return { evaluate: async () => raw } as unknown as Page;
}

function binary() {
    const device = {
        id: 'device',
        type: 'builtin-crumbs',
        parameterValues: { filterCutoff: 20000 },
        deviceState: {
            data: {
                mode: 'drum',
                activeSample: {
                    filePath: 'drops/c15-isolated-crumbs-431hz.wav',
                    fileName: 'c15-isolated-crumbs-431hz.wav',
                    frameCount: 352800,
                    sampleRate: 44100,
                    channels: 1,
                    sampleId: 1,
                },
            },
        },
    };
    const first = from({ tracks: { tracks: [{ id: 'track', devices: [device] }] } });
    const root = save(first);
    const second = change(first, (doc) => {
        doc.tracks.tracks[0]!.devices[0]!.parameterValues.filterCutoff = 19990;
    });
    return [
        ['root:incremental:1-0', Array.from(saveIncremental(second))],
        ['root', Array.from(root)],
    ] as [string, number[]][];
}

describe('readCrumbsSnapshot', () => {
    it('decodes the root and incremental into the original device row', async () => {
        const result = await readCrumbsSnapshot(pageFor(binary()), 'track', 'device');
        expect(result.snapshot).toMatchObject({
            trackId: 'track',
            deviceId: 'device',
            cutoff: 19990,
            mode: 'drum',
            sampleId: 1,
        });
        expect(result.heads.length).toBeGreaterThan(0);
    });
    it('does not admit a matching device under another track', async () => {
        await expect(readCrumbsSnapshot(pageFor(binary()), 'other', 'device')).rejects.toThrow('original track');
    });
});
