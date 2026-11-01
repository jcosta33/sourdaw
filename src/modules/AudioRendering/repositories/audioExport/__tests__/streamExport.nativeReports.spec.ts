// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { streamExport } from '../../../useCases/audioExport/streamExport';
import { joinBytes } from '../../audioEncoders/__tests__/oggCodecTestWorker';

import { expectReportDescribes, reportStem, twoWavReportTargets, wavReportTargets } from './wavReportFixtures';

const native = vi.hoisted(() => ({
    begin: vi.fn<(path: string) => Promise<string>>(),
    append: vi.fn<(token: string, bytes: Uint8Array) => Promise<void>>(),
    seal: vi.fn<(token: string) => Promise<void>>(),
    commit: vi.fn<(tokens: readonly string[]) => Promise<void>>(),
    abort: vi.fn<(tokens: readonly string[]) => Promise<void>>(),
}));

vi.mock('#/utils/desktopBridge', () => ({
    beginExportFile: native.begin,
    appendExportFile: native.append,
    sealExportFile: native.seal,
    commitExportFiles: native.commit,
    abortExportFiles: native.abort,
    desktopPathJoin: (directory: string, name: string) => Promise.resolve(`${directory}/${name}`),
}));

beforeEach(() => vi.resetAllMocks());

/** Records every native-issued token's path and staged bytes. */
function nativeStaging() {
    const paths = new Map<string, string>();
    const bytes = new Map<string, Uint8Array[]>();
    let next = 0;
    native.begin.mockImplementation(async (path) => {
        const token = `token-${++next}`;
        paths.set(token, path);
        bytes.set(token, []);
        return token;
    });
    native.append.mockImplementation(async (token, chunk) => {
        bytes.get(token)?.push(chunk.slice());
    });
    native.seal.mockImplementation(async () => {});
    native.commit.mockImplementation(async () => {});
    native.abort.mockImplementation(async () => {});
    const fileBytes = (path: string) => {
        const token = [...paths].find(([, candidate]) => candidate === path)?.[0];
        return joinBytes((token && bytes.get(token)) || []);
    };
    const committedPaths = () => native.commit.mock.calls[0]?.[0].map((token) => paths.get(token));
    return { paths, fileBytes, committedPaths };
}

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

describe('reported WAV stems on the native destination', () => {
    it('commits each report token before the WAV token it describes', async () => {
        const staged = nativeStaging();
        const output = await streamExport({
            targets: wavReportTargets(),
            destination: nativeStems,
            checkCancelled: () => {},
            includeWavLoudnessReports: true,
            exportMode: 'stems',
        });
        await writeKick(output);
        await output.writeAudio({
            source: reportStem(11),
            name: 'Snare',
            stemId: 'track-snare',
            onProgress: () => {},
            onLimited: () => {},
        });
        expect(output.reportedFiles()).toBe(0);
        await output.commit(() => {});
        expect(native.commit).toHaveBeenCalledExactlyOnceWith(['token-2', 'token-1', 'token-4', 'token-3']);
        expect(staged.committedPaths()).toEqual([
            '/stems/Kick.wav.loudness.json',
            '/stems/Kick.wav',
            '/stems/Snare.wav.loudness.json',
            '/stems/Snare.wav',
        ]);
        expectReportDescribes(
            staged.fileBytes('/stems/Kick.wav.loudness.json'),
            staged.fileBytes('/stems/Kick.wav'),
            'Kick.wav',
            'track-kick'
        );
        expectReportDescribes(
            staged.fileBytes('/stems/Snare.wav.loudness.json'),
            staged.fileBytes('/stems/Snare.wav'),
            'Snare.wav',
            'track-snare'
        );
        expect(output.reportedFiles()).toBe(2);
    });

    it('pairs each target its own report and commits each report before its own WAV', async () => {
        const staged = nativeStaging();
        const targets = twoWavReportTargets();
        const output = await streamExport({
            targets,
            destination: nativeStems,
            checkCancelled: () => {},
            includeWavLoudnessReports: true,
            exportMode: 'stems',
        });
        await writeKick(output);
        await output.commit(() => {});
        expect(native.commit).toHaveBeenCalledExactlyOnceWith(['token-2', 'token-1', 'token-4', 'token-3']);
        expect(staged.committedPaths()).toEqual([
            '/stems/Kick__a.wav.loudness.json',
            '/stems/Kick__a.wav',
            '/stems/Kick__b.wav.loudness.json',
            '/stems/Kick__b.wav',
        ]);
        for (const target of targets) {
            const audioFile = `Kick__${target.id}.wav`;
            expectReportDescribes(
                staged.fileBytes(`/stems/${audioFile}.loudness.json`),
                staged.fileBytes(`/stems/${audioFile}`),
                audioFile,
                'track-kick',
                target
            );
        }
        expect(output.reportedFiles()).toBe(2);
    });

    it.each(['begin', 'seal'] as const)('commits no WAV whose report fails to %s', async (step) => {
        const staged = nativeStaging();
        const begin = native.begin.getMockImplementation();
        native.begin.mockImplementation(async (path) => {
            if (step === 'begin' && path.endsWith('.loudness.json')) {
                throw new Error('disk full');
            }
            return begin ? begin(path) : '';
        });
        native.seal.mockImplementation(async (token) => {
            if (step === 'seal' && staged.paths.get(token)?.endsWith('.loudness.json')) {
                throw new Error('disk full');
            }
        });
        const output = await streamExport({
            targets: wavReportTargets(),
            destination: nativeStems,
            checkCancelled: () => {},
            includeWavLoudnessReports: true,
            exportMode: 'stems',
        });
        await expect(writeKick(output)).rejects.toThrow('disk full');
        const onCommitBegin = vi.fn();
        await expect(output.commit(onCommitBegin)).rejects.toThrow();
        expect(onCommitBegin).not.toHaveBeenCalled();
        expect(native.commit).not.toHaveBeenCalled();
        expect(output.reportedFiles()).toBe(0);
    });

    it.each([
        ['a mixdown', { exportMode: 'mixdown' as const }],
        ['an MP3 beside the WAV', { targets: wavReportTargets({ formats: ['wav', 'mp3'] }) }],
        ['a FLAC-only target', { targets: wavReportTargets({ formats: ['flac'] }) }],
        ['an unsupported rate', { targets: wavReportTargets({ sampleRate: 22050 }) }],
        ['more than two channels', { targets: wavReportTargets({ channels: 6 }) }],
    ])('refuses %s before any native begin', async (_case, override) => {
        nativeStaging();
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
        expect(native.begin).not.toHaveBeenCalled();
    });

    it.each([
        ['while the WAV is staging', '.wav', 'append'],
        ['as the report opens', '.loudness.json', 'begin'],
        ['while the report is staging', '.loudness.json', 'append'],
    ] as const)('commits nothing when Cancel lands %s', async (_case, suffix, step) => {
        const staged = nativeStaging();
        const controller = new AbortController();
        const begin = native.begin.getMockImplementation();
        const append = native.append.getMockImplementation();
        native.begin.mockImplementation(async (path) => {
            if (step === 'begin' && path.endsWith(suffix)) {
                controller.abort();
            }
            return begin ? begin(path) : '';
        });
        native.append.mockImplementation(async (token, bytes) => {
            if (step === 'append' && staged.paths.get(token)?.endsWith(suffix)) {
                controller.abort();
            }
            await append?.(token, bytes);
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
        await expect(output.commit(() => {})).rejects.toThrow();
        await output.abort();
        expect(native.commit).not.toHaveBeenCalled();
        const aborted = native.abort.mock.calls.flatMap(([tokens]) => [...tokens]);
        expect(staged.paths.size).toBeGreaterThan(0);
        expect(new Set(aborted)).toEqual(new Set(staged.paths.keys()));
        expect(output.reportedFiles()).toBe(0);
    });
});
