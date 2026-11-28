import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { getHeads, hasHeads, load, loadIncremental, toJS } from '@automerge/automerge';

import { compareIncrementalKeys } from '../src/modules/CrdtDocument/repositories/crdtPersistence/compareIncrementalKeys.ts';

import type { CrumbsSnapshot } from './desktopCrumbsSamplerEvidence.ts';
import type { Page } from 'playwright';

function record(value: unknown): Record<string, unknown> {
    assert(value && typeof value === 'object' && !Array.isArray(value));
    return value as Record<string, unknown>;
}

export async function readCrumbsSnapshot(
    page: Page,
    trackId: string,
    deviceId: string,
    savedHeads: string[] = []
): Promise<{ snapshot: CrumbsSnapshot; heads: string[]; savedHeadsPresent: boolean }> {
    const raw = await page.evaluate(async () => {
        const entry = (await indexedDB.databases()).find((row) => row.name === 'sourdaw-crdt-docs');
        if (!entry?.name) {
            throw new Error('missing project database');
        }
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(entry.name!, entry.version);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error ?? new Error('project database open failed'));
        });
        try {
            return await new Promise<[string, number[]][]>((resolve, reject) => {
                const transaction = database.transaction('documents', 'readonly');
                const store = transaction.objectStore('documents');
                const keys = store.getAllKeys();
                const values = store.getAll();
                transaction.oncomplete = () => {
                    try {
                        resolve(
                            keys.result.flatMap((key, index) => {
                                if (
                                    typeof key !== 'string' ||
                                    (key !== 'root' && !key.startsWith('root:incremental:'))
                                ) {
                                    return [];
                                }
                                const value: unknown = values.result[index];
                                if (!(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) {
                                    throw new TypeError('invalid binary project chunk');
                                }
                                return [
                                    [key, Array.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value)] as [
                                        string,
                                        number[],
                                    ],
                                ];
                            })
                        );
                    } catch (error) {
                        reject(error instanceof Error ? error : new Error('invalid project chunks'));
                    }
                };
                transaction.onerror = () => reject(transaction.error ?? new Error('project database read failed'));
            });
        } finally {
            database.close();
        }
    });
    return decodeCrumbsSnapshot(raw, trackId, deviceId, savedHeads);
}

function decodeCrumbsSnapshot(
    raw: [string, number[]][],
    trackId: string,
    deviceId: string,
    savedHeads: string[]
): { snapshot: CrumbsSnapshot; heads: string[]; savedHeadsPresent: boolean } {
    const root = raw.find(([key]) => key === 'root');
    assert(root, 'missing binary root');
    let document = load(Uint8Array.from(root[1]));
    for (const [, bytes] of raw
        .filter(([key]) => key !== 'root')
        .sort(([left], [right]) => compareIncrementalKeys(left, right))) {
        document = loadIncremental(document, Uint8Array.from(bytes));
    }
    const plain: unknown = toJS(document);
    const tracks = record(record(plain).tracks).tracks;
    assert(Array.isArray(tracks), 'missing binary track rows');
    const matchingTracks = tracks.map(record).filter((track) => track.id === trackId);
    assert.equal(matchingTracks.length, 1, 'missing or duplicate original track');
    const track = matchingTracks[0]!;
    assert(Array.isArray(track.devices), 'missing device rows');
    const matchingDevices = track.devices.map(record).filter((device) => device.id === deviceId);
    assert.equal(matchingDevices.length, 1, 'missing or duplicate original device');
    const device = matchingDevices[0]!;
    assert.equal(device.type, 'builtin-crumbs', 'original device is not Crumbs');
    const data = record(record(device.deviceState).data);
    const sample = record(data.activeSample);
    const parameters = record(device.parameterValues);
    assert(typeof sample.filePath === 'string' && typeof sample.fileName === 'string');
    assert(
        typeof sample.frameCount === 'number' &&
            typeof sample.sampleRate === 'number' &&
            typeof sample.channels === 'number' &&
            typeof sample.sampleId === 'number'
    );
    assert(typeof data.mode === 'string' && typeof parameters.filterCutoff === 'number');
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    return {
        snapshot: {
            trackId,
            deviceId,
            filePath: sample.filePath,
            fileName: sample.fileName,
            frameCount: sample.frameCount,
            sampleRate: sample.sampleRate,
            channels: sample.channels,
            sampleId: sample.sampleId,
            mode: data.mode,
            cutoff: parameters.filterCutoff,
            trackDigest: digest(track),
            deviceDigest: digest(device),
        },
        heads: getHeads(document),
        savedHeadsPresent: savedHeads.length > 0 && hasHeads(document, savedHeads),
    };
}
