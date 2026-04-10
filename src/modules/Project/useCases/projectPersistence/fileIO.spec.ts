import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ProjectData } from '../../models/ProjectData';
import { importProjectFile } from './fileIO';

describe('fileIO injectables', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('importProjectFile does not call applyImportedProjectData when JSON is invalid', async () => {
        const applyImportedProjectData = vi.fn();
        injectDependencies(importProjectFile, { applyImportedProjectData });
        const file = new File(['not-json{'], 'p.sourdaw');
        const result = await importProjectFile(file);
        expect(result).toBe(false);
        expect(applyImportedProjectData).not.toHaveBeenCalled();
    });

    it('importProjectFile forwards valid payloads to applyImportedProjectData', async () => {
        const applyImportedProjectData = vi.fn().mockResolvedValue(true);
        injectDependencies(importProjectFile, { applyImportedProjectData });
        const minimal: ProjectData = {
            version: 1,
            name: 't',
            createdAt: 1,
            updatedAt: 1,
            tracks: { tracks: [], selectedTrackId: null },
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
            automation: { lanes: [] },
            midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
        };
        const file = new File([JSON.stringify(minimal)], 'p.sourdaw');
        const result = await importProjectFile(file);
        expect(result).toBe(true);
        expect(applyImportedProjectData).toHaveBeenCalledTimes(1);
        expect(applyImportedProjectData).toHaveBeenCalledWith(minimal);
    });
});
