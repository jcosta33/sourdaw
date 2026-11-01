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

const [{ parseDawProject: realParser }, { mapToProjectData: realMapper }] = await Promise.all([
    vi.importActual<typeof import('../parseDawProject')>('../parseDawProject'),
    vi.importActual<typeof import('../mapToProjectData')>('../mapToProjectData'),
]);

function setupRealImport(): void {
    mocks.runProjectLoadTransaction.mockReturnValue(mockTransaction);
    mocks.parseDawProject.mockImplementation(realParser);
    mocks.mapToProjectData.mockImplementation(realMapper);
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

    it("hands the replacement the Don't Save choice for the outgoing project", async () => {
        vi.clearAllMocks();
        setupHappyPath();

        await importDawProject({ buffer: new ArrayBuffer(8), fileName: 'test.dawproject', outgoingProject: 'discard' });

        expect(mocks.applyImportedProjectData).toHaveBeenCalledWith(
            expect.objectContaining({ outgoingProject: 'discard' })
        );
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
        setupRealImport();

        const projectXml = `<?xml version="1.0"?><Project version="1.0">
            <Application name="Fixture DAW" version="1"/>
            <Structure>
                <Track id="lead" name="Lead" contentType="notes">
                    <Channel id="lead-channel"><Devices>
                        <Vst3Plugin id="verb" deviceName="Nebula Verb" deviceID="example.verb" deviceRole="audioFX"><Parameters><RealParameter unit="linear" value="0.2"/></Parameters></Vst3Plugin>
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
                    details: ['settings'],
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
            [
                expect.stringContaining(
                    'warning 1/3: Vst3Plugin "Nebula Verb" on "Lead" was replaced with a gain device; settings not imported'
                ),
                'warning',
            ],
            [expect.stringContaining('warning 2/3: Vst3Plugin "Orbit Delay" on "Lead"'), 'warning'],
            [expect.stringContaining('warning 3/3: Points "Cutoff automation" on "Lead"'), 'warning'],
            [expect.stringContaining('Warnings fixture'), 'success'],
        ]);
    });

    it('reports a direct schema-valid video once from real DAWproject bytes', async () => {
        vi.clearAllMocks();
        setupRealImport();
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
        setupRealImport();
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
        setupRealImport();
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

    it('reports local-tempo loop and warp omissions from real bytes after applying supported siblings', async () => {
        vi.clearAllMocks();
        setupRealImport();
        mocks.decodeDawProjectAssets.mockResolvedValue({
            audioBuffers: {},
            bufferIdsByPath: new Map([
                ['identity.wav', 'identity-buffer'],
                ['plain.wav', 'plain-buffer'],
            ]),
            failedPaths: [],
        });
        const projectXml = `<Project version="1.0"><Application name="Fixture" version="1.0"/>
            <Transport><Tempo value="120"/></Transport>
            <Structure><Track id="keys" name="Keys" contentType="notes"/><Track id="audio" name="Audio" contentType="audio"/></Structure>
            <Arrangement><Lanes><Points target="tempo"><RealPoint time="4" value="60"/></Points>
            <Clips track="keys"><Clip id="one-pass" name="One pass" time="8" duration="4" contentTimeUnit="seconds" playStart="0.1" loopStart="0.1" loopEnd="4.1"><Notes><Note key="60"/></Notes></Clip>
                <Clip id="repeat" name="Repeat" time="12" duration="4.0001" contentTimeUnit="seconds" playStart="0.1" loopStart="0.1" loopEnd="4.1"><Notes><Note key="62"/></Notes></Clip></Clips>
            <Clips track="audio"><Clip id="identity" name="Identity" time="8" duration="4"><Warps timeUnit="beats" contentTimeUnit="seconds"><Audio file="identity.wav"/><Warp time="0" contentTime="0"/><Warp time="4" contentTime="4"/></Warps></Clip>
                <Clip id="stretched" name="Stretched" time="12" duration="4"><Warps timeUnit="beats" contentTimeUnit="seconds"><Audio file="stretched.wav"/><Warp time="0" contentTime="0"/><Warp time="4" contentTime="2"/></Warps></Clip>
                <Clip id="plain" name="Plain" time="16" duration="1"><Audio file="plain.wav"/></Clip></Clips></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });

        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'local-tempo-leaves.dawproject',
        });

        expect(result.ok).toBe(true);
        expect(result.warnings).toMatchObject([
            { kind: 'unsupported-clip', sourceId: 'repeat', name: 'Repeat', context: 'Keys' },
            { kind: 'unsupported-clip', sourceId: 'stretched', name: 'Stretched', context: 'Audio' },
        ]);
        expect(result.warnings).toHaveLength(2);
        expect(result.warnings[0]!.sourceOrder).toBeLessThan(result.warnings[1]!.sourceOrder);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(
            applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')?.clips
        ).toMatchObject([{ name: 'One pass' }]);
        expect(
            applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Audio')?.clips
        ).toMatchObject([{ name: 'Identity' }, { name: 'Plain' }]);
        expect(mocks.notifyUser.mock.calls).toEqual([
            [expect.stringContaining('warning 1/2: Clip "Repeat" on "Keys"'), 'warning'],
            [expect.stringContaining('warning 2/2: Clip "Stretched" on "Audio"'), 'warning'],
            [expect.stringContaining('Imported local-tempo-leaves.dawproject'), 'success'],
        ]);
        expect(mocks.applyImportedProjectData.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.notifyUser.mock.invocationCallOrder[0]!
        );
    });

    it('imports cropped identity warp windows from real bytes and names only the played transforms', async () => {
        vi.clearAllMocks();
        setupRealImport();
        mocks.decodeDawProjectAssets.mockResolvedValue({
            audioBuffers: {},
            bufferIdsByPath: new Map([
                ['window.wav', 'window-buffer'],
                ['parent.wav', 'parent-buffer'],
                ['plain.wav', 'plain-buffer'],
            ]),
            failedPaths: [],
        });
        const projectXml = `<Project version="1.0"><Transport><Tempo value="120"/></Transport>
            <Structure><Track id="audio" name="Audio" contentType="audio"/></Structure>
            <Arrangement><Lanes><Clips track="audio">
                <Clip name="Cropped suffix" time="0" duration="4"><Warps timeUnit="beats" contentTimeUnit="seconds"><Audio file="window.wav"/>
                    <Warp time="0" contentTime="0"/><Warp time="4" contentTime="2"/><Warp time="8" contentTime="6"/></Warps></Clip>
                <Clip id="stretched" name="Played stretch" time="4" duration="4" playStart="2"><Warps timeUnit="beats" contentTimeUnit="seconds"><Audio file="window.wav"/>
                    <Warp time="0" contentTime="0"/><Warp time="8" contentTime="2"/></Warps></Clip>
                <Clip name="Parent" time="8" duration="16"><Audio file="parent.wav"/><Clips>
                    <Clip name="Cropped prefix" time="0" duration="4" playStart="4"><Warps timeUnit="beats" contentTimeUnit="seconds"><Audio file="window.wav"/>
                        <Warp time="0" contentTime="-1"/><Warp time="4" contentTime="2"/><Warp time="8" contentTime="4"/></Warps></Clip>
                    <Clip id="translated" name="Translated seek" time="4" duration="4" playStart="1"><Warps timeUnit="beats" contentTimeUnit="seconds"><Audio file="window.wav"/>
                        <Warp time="0" contentTime="0.5"/><Warp time="8" contentTime="4.5"/></Warps></Clip>
                </Clips></Clip>
                <Clip name="Plain" time="24" duration="4"><Audio file="plain.wav"/></Clip>
            </Clips></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });

        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'cropped-warps.dawproject',
        });

        expect(result.ok).toBe(true);
        expect(result.warnings).toMatchObject([
            {
                kind: 'unsupported-clip',
                sourceId: 'stretched',
                name: 'Played stretch',
                context: 'Audio',
                handling: 'dropped',
            },
            {
                kind: 'unsupported-clip',
                sourceId: 'translated',
                name: 'Translated seek',
                context: 'Audio',
                handling: 'dropped',
            },
        ]);
        expect(result.warnings).toHaveLength(2);
        expect(new Set(result.warnings.map((warning) => warning.sourceId)).size).toBe(2);
        expect(result.warnings[0]!.sourceOrder).toBeLessThan(result.warnings[1]!.sourceOrder);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        const clips = applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Audio')?.clips;
        expect(clips).toMatchObject([
            { name: 'Cropped suffix', sampleStartBeat: 0 },
            { name: 'Parent', sampleStartBeat: 0 },
            { name: 'Cropped prefix', sampleStartBeat: 4 },
            { name: 'Plain', sampleStartBeat: 0 },
        ]);
        expect(clips).toHaveLength(4);
        expect(mocks.notifyUser.mock.calls).toEqual([
            [expect.stringContaining('warning 1/2: Clip "Played stretch" on "Audio"'), 'warning'],
            [expect.stringContaining('warning 2/2: Clip "Translated seek" on "Audio"'), 'warning'],
            [expect.stringContaining('Imported cropped-warps.dawproject'), 'success'],
        ]);
        expect(mocks.applyImportedProjectData.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.notifyUser.mock.invocationCallOrder[0]!
        );
    });

    it('keeps a supported DAWproject import free of warning notices', async () => {
        vi.clearAllMocks();
        setupRealImport();
        const projectXml = `<?xml version="1.0"?><Project version="1.0">
            <Structure><Track id="lead" name="Lead" contentType="notes">
                <Channel><Devices><Device deviceRole="builtin-synth"><Parameters/><Enabled value="true"/></Device></Devices></Channel>
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

    it('reports named omitted elements and partial retained content from real project bytes', async () => {
        vi.clearAllMocks();
        setupRealImport();
        mocks.decodeDawProjectAssets.mockResolvedValue({
            audioBuffers: {},
            bufferIdsByPath: new Map([['take.wav', 'take-buffer']]),
            failedPaths: [],
        });
        const projectXml = `<Project version="1.0"><Application name="Fixture" version="1"/>
            <Transport><Tempo value="120"/></Transport><Structure>
                <Track id="audio" name="Audio" contentType="audio"><Channel id="channel">
                    <Sends><Send id="send" name="Verb send" destination="return"><Volume value="0.5"/></Send></Sends>
                </Channel></Track><Channel id="return" name="Reverb return" role="effect"/>
            </Structure><Arrangement><Lanes><Points target="tempo"><RealPoint time="4" value="60"/></Points>
                <Clips track="audio"><Clip id="take" name="Take" time="8" duration="4" contentTimeUnit="seconds" playStart="2" fadeInTime="1">
                    <Audio file="take.wav"/></Clip></Clips>
            </Lanes></Arrangement><Scenes><Scene id="scene" name="Chorus"><ClipSlot><Clip id="phrase" name="Scene phrase" time="0" duration="2"><Notes><Note time="0" duration="1" key="60" channel="0"/></Notes></Clip></ClipSlot></Scene></Scenes></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });

        const result = await importDawProject({ buffer: new Uint8Array(zipped).buffer, fileName: 'losses.dawproject' });

        expect(result.ok).toBe(true);
        expect(
            result.warnings.map(({ sourceType, sourceId, name, context, handling, details }) => ({
                sourceType,
                sourceId,
                name,
                context,
                handling,
                details,
            }))
        ).toEqual([
            {
                sourceType: 'Send',
                sourceId: 'send',
                name: 'Verb send',
                context: 'Audio',
                handling: 'dropped',
                details: undefined,
            },
            {
                sourceType: 'Channel',
                sourceId: 'return',
                name: 'Reverb return',
                context: 'Structure',
                handling: 'dropped',
                details: undefined,
            },
            {
                sourceType: 'Clip',
                sourceId: 'take',
                name: 'Take',
                context: 'Audio',
                handling: 'partial',
                details: ['fade', 'source offset'],
            },
            {
                sourceType: 'Scene',
                sourceId: 'scene',
                name: 'Chorus',
                context: 'Scenes',
                handling: 'dropped',
                details: undefined,
            },
            {
                sourceType: 'Clip',
                sourceId: 'phrase',
                name: 'Scene phrase',
                context: 'Chorus',
                handling: 'dropped',
                details: undefined,
            },
        ]);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(
            applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Audio')?.clips
        ).toMatchObject([{ name: 'Take', sampleStartBeat: 4 }]);
        expect(mocks.notifyUser.mock.calls).toEqual([
            [expect.stringContaining('Send "Verb send" on "Audio" was not imported'), 'warning'],
            [expect.stringContaining('Channel "Reverb return" on "Structure" was not imported'), 'warning'],
            [expect.stringContaining('Clip "Take" on "Audio" was partially imported: fade, source offset'), 'warning'],
            [expect.stringContaining('Scene "Chorus" on "Scenes" was not imported'), 'warning'],
            [expect.stringContaining('Clip "Scene phrase" on "Chorus" was not imported'), 'warning'],
            [expect.stringContaining('Imported losses.dawproject'), 'success'],
        ]);
    });

    it('keeps playable notes while reporting channel and unconsumed timeline losses from real bytes', async () => {
        vi.clearAllMocks();
        setupRealImport();
        const projectXml = `<Project version="1.0"><Application name="Fixture" version="1"/><Structure>
            <Track id="keys" name="Keys" contentType="notes"><Channel id="keys-channel" name="Mixer" role="vca" solo="true" destination="other"/></Track>
            </Structure><Arrangement><Lanes track="keys"><Notes id="direct" name="Direct"><Note key="60"/></Notes>
                <ClipSlot><Clip id="slot" name="Slot" time="0" duration="1"><Notes><Note key="62"/></Notes></Clip></ClipSlot>
                <Clips><Clip id="reference" name="Reference" time="0" duration="1" reference="source"/>
                    <Clip name="Playable" time="1" duration="2"><Notes><Note key="64" time="0" duration="1" channel="2" rel="0.3"/></Notes></Clip>
                </Clips></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });
        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'timelines.dawproject',
        });
        expect(result.ok).toBe(true);
        expect(result.warnings).toMatchObject([
            {
                sourceType: 'Channel',
                sourceId: 'keys-channel',
                name: 'Mixer',
                context: 'Keys',
                handling: 'partial',
                details: ['channel role', 'destination', 'solo', 'channel name'],
            },
            { sourceType: 'Notes', sourceId: 'direct', name: 'Direct', context: 'Keys', handling: 'dropped' },
            { sourceType: 'Clip', sourceId: 'slot', name: 'Slot', context: 'Keys', handling: 'dropped' },
            {
                sourceType: 'Clip',
                sourceId: 'reference',
                name: 'Reference',
                context: 'Keys',
                handling: 'partial',
                details: ['referenced content'],
            },
            {
                sourceType: 'Note',
                name: 'key 64',
                context: 'Keys / Playable',
                handling: 'partial',
                details: ['MIDI channel', 'release velocity'],
            },
        ]);
        expect(result.warnings).toHaveLength(5);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(
            applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')?.clips
        ).toMatchObject([{ name: 'Reference' }, { name: 'Playable' }]);
        expect(mocks.notifyUser.mock.calls.map(([message]) => message)).toEqual([
            expect.stringContaining(
                'Channel "Mixer" on "Keys" was partially imported: channel role, destination, solo, channel name'
            ),
            expect.stringContaining('Notes "Direct" on "Keys" was not imported'),
            expect.stringContaining('Clip "Slot" on "Keys" was not imported'),
            expect.stringContaining('Clip "Reference" on "Keys" was partially imported: referenced content'),
            expect.stringContaining(
                'Note "key 64" on "Keys / Playable" was partially imported: MIDI channel, release velocity'
            ),
            expect.stringContaining('Imported timelines.dawproject'),
        ]);
    });

    it('reports a named clip nested in dropped direct Notes from real bytes', async () => {
        vi.clearAllMocks();
        setupRealImport();
        const projectXml = `<Project version="1.0"><Structure><Track id="keys" name="Keys" contentType="notes"/></Structure>
            <Arrangement><Lanes track="keys"><Notes id="outer" name="Direct phrase"><Note key="60" time="0" duration="1"><Clips><Clip id="child" name="Nested phrase" time="0" duration="1"><Notes><Note key="64"/></Notes></Clip></Clips></Note></Notes>
            <Clips><Clip name="Playable" time="4" duration="1"><Notes><Note key="67"/></Notes></Clip></Clips></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });
        const result = await importDawProject({ buffer: new Uint8Array(zipped).buffer, fileName: 'nested.dawproject' });
        expect(result.warnings).toMatchObject([
            { sourceType: 'Notes', sourceId: 'outer', name: 'Direct phrase', context: 'Keys', handling: 'dropped' },
            {
                sourceType: 'Clip',
                sourceId: 'child',
                name: 'Nested phrase',
                context: 'Direct phrase',
                handling: 'dropped',
            },
        ]);
        expect(result.warnings).toHaveLength(2);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(
            applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')?.clips
        ).toMatchObject([{ name: 'Playable' }]);
        expect(mocks.notifyUser.mock.calls).toEqual([
            [expect.stringContaining('Notes "Direct phrase" on "Keys" was not imported'), 'warning'],
            [expect.stringContaining('Clip "Nested phrase" on "Direct phrase" was not imported'), 'warning'],
            [expect.stringContaining('Imported nested.dawproject'), 'success'],
        ]);
    });

    it('combines missing media and a lost fade into one warning for the retained clip', async () => {
        vi.clearAllMocks();
        setupRealImport();
        mocks.decodeDawProjectAssets.mockResolvedValue({
            audioBuffers: {},
            bufferIdsByPath: new Map(),
            failedPaths: ['missing.wav'],
        });
        const projectXml = `<Project version="1.0"><Structure><Track id="audio" name="Audio" contentType="audio"/></Structure>
            <Arrangement><Lanes><Clips track="audio"><Clip id="take" name="Take" time="0" duration="4" fadeInTime="1"><Audio file="missing.wav"/></Clip></Clips></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });
        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'missing.dawproject',
        });
        expect(result.warnings).toMatchObject([
            {
                sourceId: 'take',
                name: 'Take',
                context: 'Audio',
                handling: 'partial',
                details: ['fade', 'audio could not be loaded'],
            },
        ]);
        expect(result.warnings).toHaveLength(1);
        expect(mocks.notifyUser.mock.calls).toEqual([
            [
                expect.stringContaining(
                    'Clip "Take" on "Audio" was partially imported: fade, audio could not be loaded'
                ),
                'warning',
            ],
            [expect.stringContaining('Imported missing.dawproject'), 'success'],
        ]);
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
    it('reports rejected named notes and invalid mixer values from real ZIP bytes', async () => {
        vi.clearAllMocks();
        setupRealImport();
        const projectXml = `<Project version="1.0"><Structure><Channel id="return" name="Return"/><Track id="keys" name="Keys" contentType="notes"><Channel><Volume id="vol" unit="linear" value="not-a-number"/><Pan id="pan" value="Infinity"/></Channel></Track></Structure><Arrangement><Lanes><Clips track="return"><Clip id="orphan" name="Orphan" time="0" duration="1"><Notes id="verse" name="Verse"><Note key="60" time="0" duration="1"/></Notes></Clip></Clips><Clips track="keys"><Clip name="Playable" time="0" duration="1"><Notes><Note key="64" time="0" duration="1"/></Notes></Clip></Clips></Lanes></Arrangement></Project>`;
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });
        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'rejected.dawproject',
        });
        expect(result.warnings).toMatchObject([
            { sourceType: 'Channel', sourceId: 'return', name: 'Return', context: 'Structure', handling: 'dropped' },
            {
                sourceType: 'Volume',
                sourceId: 'vol',
                name: 'Volume',
                context: 'Keys',
                handling: 'partial',
                details: ['invalid parameter value'],
            },
            {
                sourceType: 'Pan',
                sourceId: 'pan',
                name: 'Pan',
                context: 'Keys',
                handling: 'partial',
                details: ['invalid parameter value'],
            },
            { sourceType: 'Clip', sourceId: 'orphan', name: 'Orphan', context: 'return', handling: 'dropped' },
            { sourceType: 'Notes', sourceId: 'verse', name: 'Verse', context: 'Orphan', handling: 'dropped' },
        ]);
        expect(result.warnings).toHaveLength(5);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')).toMatchObject({
            gain: 0.8,
            pan: 0,
            clips: [{ name: 'Playable' }],
        });
        expect(mocks.notifyUser.mock.calls.map(([message]) => message)).toEqual([
            expect.stringContaining('Channel "Return" on "Structure" was not imported'),
            expect.stringContaining('Volume "Volume" on "Keys" was partially imported: invalid parameter value'),
            expect.stringContaining('Pan "Pan" on "Keys" was partially imported: invalid parameter value'),
            expect.stringContaining('Clip "Orphan" on "return" was not imported'),
            expect.stringContaining('Notes "Verse" on "Orphan" was not imported'),
            expect.stringContaining('Imported rejected.dawproject'),
        ]);
    });
    it('warns for blank mixer values from real ZIP bytes without changing mapped values', async () => {
        vi.clearAllMocks();
        setupRealImport();
        const projectXml =
            '<Project version="1.0"><Structure><Track id="keys" name="Keys" contentType="notes"><Channel><Volume id="empty" value=""/><Pan id="space" value="   "/></Channel></Track></Structure><Arrangement><Lanes><Clips track="keys"><Clip name="Playable" time="0" duration="1"><Notes><Note key="64" time="0" duration="1"/></Notes></Clip></Clips></Lanes></Arrangement></Project>';
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });
        const result = await importDawProject({ buffer: new Uint8Array(zipped).buffer, fileName: 'blank.dawproject' });
        expect(result.warnings).toMatchObject([
            {
                sourceType: 'Volume',
                sourceId: 'empty',
                name: 'Volume',
                context: 'Keys',
                handling: 'partial',
                details: ['invalid parameter value'],
            },
            {
                sourceType: 'Pan',
                sourceId: 'space',
                name: 'Pan',
                context: 'Keys',
                handling: 'partial',
                details: ['invalid parameter value'],
            },
        ]);
        expect(result.warnings).toHaveLength(2);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')).toMatchObject({
            gain: 0,
            pan: -1,
            clips: [{ name: 'Playable' }],
        });
        expect(mocks.notifyUser.mock.calls.map(([message]) => message)).toEqual([
            expect.stringContaining('Volume "Volume" on "Keys" was partially imported: invalid parameter value'),
            expect.stringContaining('Pan "Pan" on "Keys" was partially imported: invalid parameter value'),
            expect.stringContaining('Imported blank.dawproject'),
        ]);
    });
    it('reports custom mixer bounds from real ZIP bytes while retaining values and playable content', async () => {
        vi.clearAllMocks();
        setupRealImport();
        const projectXml =
            '<Project version="1.0"><Structure><Track id="keys" name="Keys" contentType="notes"><Channel><Volume id="vol" value="0.75" min="0.25" max="0.9"/><Pan id="pan" value="0.75" min="0.25" max="0.75"/></Channel></Track></Structure><Arrangement><Lanes><Clips track="keys"><Clip name="Playable" time="0" duration="1"><Notes><Note key="64" time="0" duration="1"/></Notes></Clip></Clips></Lanes></Arrangement></Project>';
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });
        const result = await importDawProject({ buffer: new Uint8Array(zipped).buffer, fileName: 'bounds.dawproject' });
        expect(result.warnings).toMatchObject([
            {
                sourceType: 'Volume',
                sourceId: 'vol',
                name: 'Volume',
                context: 'Keys',
                handling: 'partial',
                details: ['parameter bounds'],
            },
            {
                sourceType: 'Pan',
                sourceId: 'pan',
                name: 'Pan',
                context: 'Keys',
                handling: 'partial',
                details: ['parameter bounds'],
            },
        ]);
        expect(result.warnings).toHaveLength(2);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')).toMatchObject({
            gain: 0.75,
            pan: 0.5,
            clips: [{ name: 'Playable' }],
        });
        expect(mocks.notifyUser.mock.calls.map(([message]) => message)).toEqual([
            expect.stringContaining('Volume "Volume" on "Keys" was partially imported: parameter bounds'),
            expect.stringContaining('Pan "Pan" on "Keys" was partially imported: parameter bounds'),
            expect.stringContaining('Imported bounds.dawproject'),
        ]);
    });
    it('keeps standard pan bounds quiet in a real ZIP while reporting custom bounds', async () => {
        vi.clearAllMocks();
        setupRealImport();
        const projectXml =
            '<Project version="1.0"><Structure><Track id="keys" name="Keys" contentType="notes"><Channel><Pan id="standard" unit="normalized" min="0" max="1" value="0.75"/></Channel></Track><Track id="custom" name="Custom" contentType="notes"><Channel><Pan id="custom-pan" name="Position" min="0.25" max="0.75" value="0.75"/></Channel></Track></Structure><Arrangement><Lanes><Clips track="keys"><Clip name="Playable" time="0" duration="1"><Notes><Note key="64" time="0" duration="1"/></Notes></Clip></Clips></Lanes></Arrangement></Project>';
        const zipped = buildDawProjectZip({ projectXml, metadataXml: '', audioFiles: new Map() });
        const result = await importDawProject({
            buffer: new Uint8Array(zipped).buffer,
            fileName: 'standard-pan.dawproject',
        });
        expect(result.warnings).toMatchObject([
            {
                sourceType: 'Pan',
                sourceId: 'custom-pan',
                name: 'Position',
                context: 'Custom',
                handling: 'partial',
                details: ['parameter name', 'parameter bounds'],
            },
        ]);
        expect(result.warnings).toHaveLength(1);
        const applied = mocks.applyImportedProjectData.mock.calls[0]?.[0]?.data;
        expect(applied.arrangement.tracks.find((track: { name: string }) => track.name === 'Keys')).toMatchObject({
            pan: 0.5,
            clips: [{ name: 'Playable' }],
        });
        expect(mocks.notifyUser.mock.calls.map(([message]) => message)).toEqual([
            expect.stringContaining(
                'Pan "Position" on "Custom" was partially imported: parameter name, parameter bounds'
            ),
            expect.stringContaining('Imported standard-pan.dawproject'),
        ]);
    });
});
