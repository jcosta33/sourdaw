import { describe, expect, it, vi } from 'vitest';

import { buildDawProjectZip } from '../buildDawProjectZip';
import { importDawProject } from '../importDawProject';

const mocks = vi.hoisted(() => ({
    runProjectLoadTransaction: vi.fn(),
    parseDawProject: vi.fn(),
    decodeDawProjectAssets: vi.fn(),
    mapToProjectData: vi.fn(),
    applyImportedProjectData: vi.fn(),
    notifyUser: vi.fn(),
    logger: { warn: vi.fn() },
}));

vi.mock('#/modules/Project/useCases', () => ({
    runProjectLoadTransaction: mocks.runProjectLoadTransaction,
    applyImportedProjectData: mocks.applyImportedProjectData,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('../decodeDawProjectAssets', () => ({
    decodeDawProjectAssets: mocks.decodeDawProjectAssets,
}));

vi.mock('../mapToProjectData', () => ({
    mapToProjectData: mocks.mapToProjectData,
}));

vi.mock('../parseDawProject', () => ({
    parseDawProject: mocks.parseDawProject,
}));

// Keep the real ZIP guard and XML parser. jsdom has no Worker, so only the
// worker transport is replaced with the production extraction core.
vi.mock('../extractDawProjectZipEntries', async () => {
    const { runDawProjectZipWorkerRequest } = await import('../runDawProjectZipWorkerRequest');
    return {
        extractDawProjectZipEntries: (
            input: Parameters<typeof import('../extractDawProjectZipEntries').extractDawProjectZipEntries>[0]
        ) =>
            Promise.resolve({
                entries: runDawProjectZipWorkerRequest({
                    bytes: input.bytes.slice().buffer,
                    phase: input.phase,
                    restrictLimits: input.restrictLimits,
                }),
            }),
    };
});

const mockTransaction = { canActivate: () => true };

function setupHappyPath() {
    mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
    mocks.parseDawProject.mockReturnValue({
        meta: { title: 'My Song' },
        audioAssets: [],
    });
    mocks.decodeDawProjectAssets.mockResolvedValue({
        audioBuffers: [],
        bufferIdsByPath: {},
        failedPaths: [],
    });
    mocks.mapToProjectData.mockReturnValue({
        arrangement: { tracks: [{ id: 't1' }, { id: 't2' }] },
    });
    mocks.applyImportedProjectData.mockResolvedValue(true);
}

async function setupRealImport(): Promise<void> {
    const { parseDawProject } = await vi.importActual<typeof import('../parseDawProject')>('../parseDawProject');
    const { mapToProjectData } = await vi.importActual<typeof import('../mapToProjectData')>('../mapToProjectData');
    mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
    mocks.parseDawProject.mockImplementation(parseDawProject);
    mocks.mapToProjectData.mockImplementation(mapToProjectData);
    mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: {}, bufferIdsByPath: new Map(), failedPaths: [] });
    mocks.applyImportedProjectData.mockResolvedValue(true);
}

describe('importDawProject', () => {
    it('returns false and notifies on parse error', async () => {
        mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
        mocks.parseDawProject.mockImplementation(() => {
            throw new Error('bad xml');
        });

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toEqual({ ok: false, warnings: [] });
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('bad xml'), 'error');
        expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    });

    it('returns false when transaction is cancelled after decode', async () => {
        const cancelledTransaction = { canActivate: () => false };
        mocks.runProjectLoadTransaction.mockReturnValue(cancelledTransaction);
        mocks.parseDawProject.mockReturnValue({ meta: { title: '' }, audioAssets: [] });
        mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toEqual({ ok: false, warnings: [] });
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
    });

    it('returns true and notifies success on happy path', async () => {
        setupHappyPath();
        vi.clearAllMocks();
        setupHappyPath();

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toEqual({ ok: true, warnings: [] });
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('My Song'), 'success');
        expect(mocks.notifyUser.mock.calls[0]?.[0]).toContain('2 tracks');
    });

    it('notifies with fileName when title is empty', async () => {
        vi.clearAllMocks();
        mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
        mocks.parseDawProject.mockReturnValue({ meta: { title: '' }, audioAssets: [] });
        mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });
        mocks.mapToProjectData.mockReturnValue({ arrangement: { tracks: [{ id: 't1' }] } });
        mocks.applyImportedProjectData.mockResolvedValue(true);

        await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'myfile.dawproject' });

        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('myfile.dawproject'), 'success');
    });

    it('returns false and notifies on apply error', async () => {
        vi.clearAllMocks();
        mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
        mocks.parseDawProject.mockReturnValue({ meta: { title: '' }, audioAssets: [] });
        mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });
        mocks.mapToProjectData.mockReturnValue({ arrangement: { tracks: [] } });
        mocks.applyImportedProjectData.mockRejectedValue(new Error('apply failed'));

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toEqual({ ok: false, warnings: [] });
        expect(mocks.notifyUser).toHaveBeenCalledWith('Failed to apply imported DAWproject data', 'error');
    });

    // Choosing the open project's Recent entry while the import is pending
    // withdraws it through its caller's check, which the transaction cannot see.
    it('does not apply a project its caller withdrew while the assets decoded', async () => {
        vi.clearAllMocks();
        setupHappyPath();
        let isStillChosen = true;
        mocks.decodeDawProjectAssets.mockImplementationOnce(({ shouldContinue }: { shouldContinue: () => boolean }) => {
            expect(shouldContinue()).toBe(true);
            isStillChosen = false;
            expect(shouldContinue()).toBe(false);
            return Promise.resolve({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });
        });

        const result = await importDawProject({
            buffer: new ArrayBuffer(8),
            fileName: 'test.dawproject',
            shouldProceed: () => isStillChosen,
        });

        expect(result).toEqual({ ok: false, warnings: [] });
        expect(mocks.applyImportedProjectData).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('hands the replacement its caller continuation check', async () => {
        vi.clearAllMocks();
        setupHappyPath();
        const shouldProceed = (): boolean => true;

        await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject', shouldProceed });

        expect(mocks.applyImportedProjectData).toHaveBeenCalledWith(expect.objectContaining({ shouldProceed }));
    });

    it('does not notify success when apply returns false', async () => {
        vi.clearAllMocks();
        mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
        mocks.parseDawProject.mockReturnValue({ meta: { title: 'X' }, audioAssets: [] });
        mocks.decodeDawProjectAssets.mockResolvedValue({ audioBuffers: [], bufferIdsByPath: {}, failedPaths: [] });
        mocks.mapToProjectData.mockReturnValue({ arrangement: { tracks: [{ id: 't1' }] } });
        mocks.applyImportedProjectData.mockResolvedValue(false);

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject' });

        expect(result).toEqual({ ok: false, warnings: [] });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it.each(['transaction', 'caller'] as const)(
        'keeps a committed %s import result but leaves a successor free of stale notices',
        async (revokedBy) => {
            vi.clearAllMocks();
            setupHappyPath();
            let transactionCurrent = true;
            let callerCurrent = true;
            let activeProject = 'imported';
            let finishApply: ((committed: boolean) => void) | undefined;
            mocks.runProjectLoadTransaction.mockReturnValue({ canActivate: () => transactionCurrent });
            mocks.parseDawProject.mockReturnValue({
                meta: { title: 'Old import' },
                audioAssets: new Map(),
                warnings: [
                    {
                        kind: 'unsupported-automation',
                        name: 'Cutoff',
                        sourceType: 'Points',
                        context: 'Lead',
                        handling: 'dropped',
                        sourceOrder: 1,
                    },
                ],
            });
            mocks.applyImportedProjectData.mockImplementationOnce(
                () =>
                    new Promise<boolean>((resolve) => {
                        finishApply = resolve;
                    })
            );

            const importing = importDawProject({
                buffer: new ArrayBuffer(8),
                fileName: 'old.dawproject',
                shouldProceed: () => callerCurrent,
            });
            await vi.waitFor(() => expect(mocks.applyImportedProjectData).toHaveBeenCalledTimes(1));
            expect(activeProject).toBe('imported');
            if (revokedBy === 'transaction') {
                transactionCurrent = false;
            } else {
                callerCurrent = false;
            }
            activeProject = 'successor';
            if (!finishApply) {
                throw new Error('Expected pending post-commit apply');
            }
            finishApply(true);

            await expect(importing).resolves.toMatchObject({ ok: false, warnings: [{ name: 'Cutoff' }] });
            expect(activeProject).toBe('successor');
            expect(mocks.notifyUser).not.toHaveBeenCalled();
        }
    );

    it('returns every named unsupported device and automation warning from real DAWproject bytes', async () => {
        vi.clearAllMocks();
        await setupRealImport();

        const projectXml = `<?xml version="1.0"?><Project version="1.0">
            <Application name="Fixture DAW" version="1"/>
            <Structure>
                <Track id="lead" name="Lead" contentType="notes">
                    <Channel id="lead-channel"><Devices>
                        <Vst3Plugin id="verb" deviceName="Nebula Verb" deviceID="example.verb" deviceRole="audioFX"/>
                        <Vst3Plugin id="delay" deviceName="Orbit Delay" deviceID="example.delay" deviceRole="audioFX"/>
                    </Devices></Channel>
                </Track>
            </Structure>
            <Arrangement><Lanes>
                <Points name="Cutoff automation" track="lead"><Target parameter="filter-cutoff"/>
                    <RealPoint time="0" value="0.5"/>
                </Points>
            </Lanes></Arrangement>
        </Project>`;
        const zipped = buildDawProjectZip({
            projectXml,
            metadataXml: '<MetaData><Title>Warnings fixture</Title></MetaData>',
            audioFiles: new Map(),
        });

        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'warnings.dawproject',
        });

        expect(result).toMatchObject({
            ok: true,
            warnings: [
                {
                    kind: 'unsupported-device',
                    name: 'Nebula Verb',
                    sourceType: 'Vst3Plugin',
                    context: 'Lead',
                    handling: 'substituted',
                },
                {
                    kind: 'unsupported-device',
                    name: 'Orbit Delay',
                    sourceType: 'Vst3Plugin',
                    context: 'Lead',
                    handling: 'substituted',
                },
                {
                    kind: 'unsupported-automation',
                    name: 'Cutoff automation',
                    sourceType: 'Points',
                    context: 'Lead',
                    handling: 'dropped',
                },
            ],
        });
        expect(mocks.notifyUser.mock.calls.map(([message]) => message)).toEqual(
            expect.arrayContaining([
                expect.stringContaining('Nebula Verb'),
                expect.stringContaining('Orbit Delay'),
                expect.stringContaining('Cutoff automation'),
            ])
        );
        expect(mocks.notifyUser.mock.calls.map(([message, level]) => [message, level])).toEqual([
            [expect.stringContaining('warning 1/3: Vst3Plugin "Nebula Verb" on "Lead"'), 'warning'],
            [expect.stringContaining('warning 2/3: Vst3Plugin "Orbit Delay" on "Lead"'), 'warning'],
            [expect.stringContaining('warning 3/3: Points "Cutoff automation" on "Lead"'), 'warning'],
            [expect.stringContaining('Warnings fixture'), 'success'],
        ]);
    });

    it('reports a direct schema-valid video once from real DAWproject bytes', async () => {
        vi.clearAllMocks();
        await setupRealImport();
        const projectXml = `<Project version="1.0"><Application name="Fixture" version="1.0"/>
            <Structure><Track id="t0" name="Picture" contentType="audio"/></Structure>
            <Arrangement><Lanes timeUnit="beats"><Video track="t0" duration="8" channels="2" sampleRate="48000">
                <File path="video.mp4"/></Video></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });

        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'picture.dawproject',
        });

        expect(result).toMatchObject({
            ok: true,
            warnings: [
                {
                    kind: 'unsupported-clip',
                    name: 'video.mp4',
                    sourceType: 'Video',
                    context: 'Picture',
                    handling: 'dropped',
                    sourceOrder: 5,
                },
            ],
        });
        expect(result.warnings).toHaveLength(1);
        expect(mocks.notifyUser.mock.calls).toEqual([
            [expect.stringContaining('Video "video.mp4" on "Picture"'), 'warning'],
            [expect.stringContaining('Imported picture.dawproject'), 'success'],
        ]);
    });

    it('returns source-ordered direct leaf omissions from real bytes and notifies after a successful apply', async () => {
        vi.clearAllMocks();
        await setupRealImport();
        const projectXml = `<Project version="1.0"><Application name="Fixture" version="1.0"/>
            <Transport><Tempo value="120"/></Transport>
            <Structure><Track id="keys" name="Keys" contentType="notes"/>
                <Track id="audio" name="Audio" contentType="audio"/></Structure>
            <Arrangement><Lanes timeUnit="beats"><Clips track="keys">
                <Clip id="repeat" name="Repeating phrase" time="0" duration="8" loopStart="0" loopEnd="4">
                    <Notes><Note time="0" duration="1" key="60"/></Notes></Clip>
                <Clip id="plain" name="Plain phrase" time="8" duration="2">
                    <Notes><Note time="0" duration="1" key="62"/></Notes></Clip>
            </Clips><Clips track="audio"><Clip id="warped" name="Stretched take" time="0" duration="4">
                <Warps timeUnit="beats" contentTimeUnit="seconds"><Audio file="stretched.wav"/>
                    <Warp time="0" contentTime="0"/><Warp time="4" contentTime="1"/>
                </Warps></Clip></Clips></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });

        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'direct-leaves.dawproject',
        });

        expect(result.ok).toBe(true);
        expect(result.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                sourceId: 'repeat',
                name: 'Repeating phrase',
                context: 'Keys',
            },
            {
                kind: 'unsupported-clip',
                sourceType: 'Clip',
                sourceId: 'warped',
                name: 'Stretched take',
                context: 'Audio',
            },
        ]);
        expect(result.warnings).toHaveLength(2);
        expect(result.warnings[0]!.sourceOrder).toBeLessThan(result.warnings[1]!.sourceOrder);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(
            applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')?.clips
        ).toMatchObject([{ name: 'Plain phrase' }]);
        expect(applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Audio')?.clips).toEqual([]);
        expect(mocks.notifyUser.mock.calls).toEqual([
            [expect.stringContaining('warning 1/2: Clip "Repeating phrase" on "Keys"'), 'warning'],
            [expect.stringContaining('warning 2/2: Clip "Stretched take" on "Audio"'), 'warning'],
            [expect.stringContaining('Imported direct-leaves.dawproject'), 'success'],
        ]);
        expect(mocks.applyImportedProjectData.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.notifyUser.mock.invocationCallOrder[0]!
        );
    });

    it('imports decimal one-pass Notes leaves from real bytes and warns only for the real repeat', async () => {
        vi.clearAllMocks();
        await setupRealImport();
        const projectXml = `<Project version="1.0"><Application name="Fixture" version="1.0"/>
            <Transport><Tempo value="120"/></Transport>
            <Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>
            <Arrangement><Lanes timeUnit="beats"><Clips track="keys">
                <Clip id="beat" name="Beat one pass" time="1" duration="2.2" playStart="1.1" loopStart="1.1" loopEnd="3.3">
                    <Notes><Note time="0" duration="0.5" key="60"/></Notes></Clip>
                <Clip id="seconds" name="Seconds one pass" time="28.2" duration="2.2" contentTimeUnit="seconds" playStart="0.05" loopStart="0.05" loopEnd="1.15">
                    <Notes><Note time="0" duration="0.25" key="62"/></Notes></Clip>
                <Clip id="repeat" name="Real repeat" time="36.2" duration="2.2001" playStart="1.1" loopStart="1.1" loopEnd="3.3">
                    <Notes><Note time="0" duration="0.5" key="64"/></Notes></Clip>
                <Clip id="plain" name="Plain" time="40.2" duration="1"><Notes>
                    <Note time="0" duration="0.5" key="67"/></Notes></Clip>
            </Clips></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });

        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'decimal-loops.dawproject',
        });

        expect(result).toMatchObject({
            ok: true,
            warnings: [
                {
                    kind: 'unsupported-clip',
                    sourceId: 'repeat',
                    name: 'Real repeat',
                    context: 'Keys',
                    handling: 'dropped',
                },
            ],
        });
        expect(result.warnings).toHaveLength(1);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(
            applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')?.clips
        ).toMatchObject([{ name: 'Beat one pass' }, { name: 'Seconds one pass' }, { name: 'Plain' }]);
        expect(mocks.notifyUser.mock.calls).toEqual([
            [expect.stringContaining('Clip "Real repeat" on "Keys"'), 'warning'],
            [expect.stringContaining('Imported decimal-loops.dawproject'), 'success'],
        ]);
    });

    it('keeps a supported DAWproject import free of warning notices', async () => {
        vi.clearAllMocks();
        await setupRealImport();
        const projectXml = `<?xml version="1.0"?><Project version="1.0">
            <Structure><Track id="lead" name="Lead" contentType="notes">
                <Channel><Devices><Device deviceRole="builtin-synth"/></Devices></Channel>
            </Track></Structure>
            <Arrangement><Lanes><Clips track="lead"><Clip name="Phrase" time="0" duration="2">
                <Notes><Note key="60" time="0" duration="1"/></Notes>
            </Clip></Clips><Points target="tempo"><RealPoint time="0" value="120"/></Points></Lanes></Arrangement>
        </Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });

        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'supported.dawproject',
        });

        expect(result).toEqual({ ok: true, warnings: [] });
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            expect.stringContaining('Imported supported.dawproject'),
            'success'
        );
    });

    it('does not report warnings before a refused project apply', async () => {
        vi.clearAllMocks();
        setupHappyPath();
        mocks.parseDawProject.mockReturnValue({
            meta: { title: 'X' },
            audioAssets: new Map(),
            warnings: [
                {
                    kind: 'unsupported-automation',
                    name: 'Cutoff',
                    sourceType: 'Points',
                    context: 'Lead',
                    handling: 'dropped',
                    sourceOrder: 1,
                },
            ],
        });
        mocks.applyImportedProjectData.mockResolvedValue(false);

        const result = await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'refused.dawproject' });

        expect(result).toMatchObject({ ok: false, warnings: [{ name: 'Cutoff' }] });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
