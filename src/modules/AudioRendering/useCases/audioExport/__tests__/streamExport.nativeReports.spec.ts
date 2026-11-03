// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { joinBytes } from '../../../repositories/audioEncoders/__tests__/oggCodecTestWorker';
import { streamExportToNative } from '../../../repositories/audioExport/streamExportToNative';
import { streamExport } from '../streamExport';

import { expectReportDescribes, reportStem, twoWavReportTargets, wavReportTargets } from './wavReportFixtures';

vi.mock('../../../repositories/audioExport/streamExportToNative', () => ({ streamExportToNative: vi.fn() }));

const openNative = vi.mocked(streamExportToNative);

type BatchEvent = 'begin' | 'write' | 'finish' | 'register';

/** A native batch that records each entry's bytes and every call, checking cancellation like the adapter. */
function recordingNativeBatch(onEvent: (event: BatchEvent, name: string) => void = () => {}) {
    const files = new Map<string, Uint8Array[]>();
    const pairs: [string, string][] = [];
    const record = { files, pairs, bytesOf: (name: string) => joinBytes(files.get(name) ?? []) };
    const batch = {
        beginFile: vi.fn(),
        registerReportPair: vi.fn(),
        commit: vi.fn(),
        abort: vi.fn(async () => {}),
    };
    openNative.mockImplementation(async ({ checkCancelled }) => {
        batch.beginFile.mockImplementation(async (name: string) => {
            onEvent('begin', name);
            checkCancelled();
            const chunks: Uint8Array[] = [];
            files.set(name, chunks);
            return {
                writer: {
                    checkCancelled,
                    async write(bytes: Uint8Array) {
                        onEvent('write', name);
                        checkCancelled();
                        chunks.push(bytes.slice());
                    },
                },
                async finish() {
                    onEvent('finish', name);
                    checkCancelled();
                },
            };
        });
        batch.registerReportPair.mockImplementation((audioName: string, reportName: string) => {
            onEvent('register', audioName);
            checkCancelled();
            pairs.push([audioName, reportName]);
        });
        batch.commit.mockImplementation(async (onCommitBegin: () => void) => {
            checkCancelled();
            onCommitBegin();
        });
        return batch;
    });
    return { batch, record };
}

beforeEach(() => vi.resetAllMocks());

const nativeStems = { kind: 'native' as const, directoryPath: '/stems' };

function writeKick(output: Awaited<ReturnType<typeof streamExport>>) {
    return output.writeAudio({
        source: reportStem(0),
        name: 'Kick',
        stemId: 'track-kick',
        onProgress: () => {},
        onLimited: () => {},
    });
}

describe('reported WAV stems on the native adapter', () => {
    it('stages each target its own report of the exact bytes written to its own WAV', async () => {
        const { batch, record } = recordingNativeBatch();
        const targets = twoWavReportTargets();
        const output = await streamExport({
            targets,
            destination: nativeStems,
            checkCancelled: () => {},
            includeWavLoudnessReports: true,
            exportMode: 'stems',
        });
        await writeKick(output);
        expect(output.reportedFiles()).toBe(0);
        await output.commit(() => {});
        expect(openNative).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ directoryPath: '/stems', requireReportPairs: true })
        );
        expect([...record.files.keys()]).toEqual([
            'Kick__a.wav',
            'Kick__a.wav.loudness.json',
            'Kick__b.wav',
            'Kick__b.wav.loudness.json',
        ]);
        expect(record.pairs).toEqual([
            ['Kick__a.wav', 'Kick__a.wav.loudness.json'],
            ['Kick__b.wav', 'Kick__b.wav.loudness.json'],
        ]);
        for (const target of targets) {
            const audioFile = `Kick__${target.id}.wav`;
            expectReportDescribes(
                record.bytesOf(`${audioFile}.loudness.json`),
                record.bytesOf(audioFile),
                audioFile,
                'track-kick',
                target
            );
        }
        expect(batch.commit).toHaveBeenCalledOnce();
        expect(output.reportedFiles()).toBe(2);
    });

    it.each([
        ['a mixdown', { exportMode: 'mixdown' as const }],
        ['an MP3 beside the WAV', { targets: wavReportTargets({ formats: ['wav', 'mp3'] }) }],
        ['a FLAC-only target', { targets: wavReportTargets({ formats: ['flac'] }) }],
        ['an unsupported rate', { targets: wavReportTargets({ sampleRate: 22050 }) }],
        ['more than two channels', { targets: wavReportTargets({ channels: 6 }) }],
    ])('refuses %s before the native adapter opens', async (_case, override) => {
        recordingNativeBatch();
        await expect(
            streamExport({
                targets: wavReportTargets(),
                destination: nativeStems,
                checkCancelled: () => {},
                includeWavLoudnessReports: true,
                exportMode: 'stems',
                ...override,
            })
        ).rejects.toThrow(/WAV loudness reports/);
        expect(openNative).not.toHaveBeenCalled();
    });

    it.each([
        ['while the WAV is staging', 'write', 'Kick.wav'],
        ['as the report opens', 'begin', 'Kick.wav.loudness.json'],
        ['while the report is staging', 'write', 'Kick.wav.loudness.json'],
        ['as the pair registers', 'register', 'Kick.wav'],
    ] as const)('aborts the batch and commits nothing when Cancel lands %s', async (_case, event, name) => {
        const controller = new AbortController();
        const { batch, record } = recordingNativeBatch((seen, entry) => {
            if (seen === event && entry === name) {
                controller.abort();
            }
        });
        const output = await streamExport({
            targets: wavReportTargets(),
            destination: nativeStems,
            checkCancelled: () => {
                if (controller.signal.aborted) {
                    throw new Error('Export cancelled');
                }
            },
            signal: controller.signal,
            includeWavLoudnessReports: true,
            exportMode: 'stems',
        });
        await expect(writeKick(output)).rejects.toThrow('Export cancelled');
        expect(controller.signal.aborted).toBe(true);
        const onCommitBegin = vi.fn();
        await expect(output.commit(onCommitBegin)).rejects.toThrow('Export cancelled');
        await output.abort();
        expect(batch.abort).toHaveBeenCalledOnce();
        expect(onCommitBegin).not.toHaveBeenCalled();
        expect(record.pairs).toEqual([]);
        expect(output.reportedFiles()).toBe(0);
    });
});
