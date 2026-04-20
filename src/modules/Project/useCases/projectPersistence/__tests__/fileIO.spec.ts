import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { type ProjectData } from '../../../models/ProjectData';
import { importProjectFile } from '../fileIO/pickAndImportProjectFile';
import { applyImportedProjectData } from '../fileIO/applyImportedProjectData';

vi.mock('../fileIO/applyImportedProjectData', () => ({
    applyImportedProjectData: vi.fn().mockResolvedValue(true),
}));

describe('fileIO injectables', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('importProjectFile does not call applyImportedProjectData when JSON is invalid', async () => {
        const file = new File(['not-json{'], 'p.sourdaw');
        const result = await importProjectFile(file);
        expect(result).toBe(false);
        expect(applyImportedProjectData).not.toHaveBeenCalled();
    });

    it('importProjectFile forwards valid payloads to applyImportedProjectData', async () => {
        const minimal = {
            version: 1,
            meta: {
                name: 't',
                createdAt: 1,
                updatedAt: 1,
                keyRoot: 0,
                scaleName: 'major',
                tuning: { name: 'equal', frequencies: [] },
            },
            arrangement: { tracks: [] },
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            transport: {
                tempo: 120,
                timeSignatureNumerator: 4,
                timeSignatureDenominator: 4,
                loopStart: 0,
                loopEnd: 0,
                isLooping: false,
                metronomeEnabled: false,
                metronomeVolume: 0.5,
                punchInEnabled: false,
                punchInBeat: 0,
                punchOutBeat: 16,
                countInEnabled: false,
                countInBars: 1,
                preRollEnabled: false,
                preRollBars: 2,
                masterGain: 80,
            },
            mixer: { master: { gain: 1, pan: 0 }, buses: [] },
            markers: [],
            history: { checkpoints: [] },
        } as unknown as ProjectData;
        const file = new File([JSON.stringify(minimal)], 'p.sourdaw');
        const result = await importProjectFile(file);
        expect(result).toBe(true);
        expect(applyImportedProjectData).toHaveBeenCalledTimes(1);
        expect(applyImportedProjectData).toHaveBeenCalledWith(minimal);
    });
});
