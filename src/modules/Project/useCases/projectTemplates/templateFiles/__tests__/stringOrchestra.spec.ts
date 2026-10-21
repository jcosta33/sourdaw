import { describe, expect, it, vi } from 'vitest';

import { sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { hydrateLevainStateFromProject, nativeBankKeyForLevainDeviceState } from '#/modules/Levain/useCases';

import { handleCreateProjectFromTemplate } from '../../../../handlers/projectTemplate/handleCreateProjectFromTemplate';
import { arrangementStore } from '../../../../stores/arrangementStore';
import { hydrateArrangementTracks } from '../../../projectPersistence/fileIO/hydrateArrangementTracks';
import { serializeArrangementTracks } from '../../../projectPersistence/fileIO/serializeArrangementTracks';
import { getTemplates } from '../../templateDefinitions/getTemplates';

import type { Track } from '#/modules/Arrangement/stores';

vi.mock('../../templateHelpers/finalizeTemplate', async () => {
    const { trackStore } = await import('#/modules/Arrangement/stores');
    const { syncArrangement } = await import('../../../demoProjects/demoUtils/syncArrangement');
    return {
        finalizeTemplate: async ({ tracks, selectTrackId }: { tracks: Track[]; selectTrackId?: string }) => {
            trackStore.set({ tracks, selectedTrackId: selectTrackId ?? null });
            syncArrangement(tracks);
        },
    };
});

const expectedSections = [
    { name: 'Violins I', instrumentId: 'violin-1', pan: -0.6, gain: 0.72, send: 0.38 },
    { name: 'Violins II', instrumentId: 'violin-2', pan: -0.3, gain: 0.7, send: 0.36 },
    { name: 'Violas', instrumentId: 'viola', pan: 0.1, gain: 0.72, send: 0.34 },
    { name: 'Cellos', instrumentId: 'cello', pan: 0.38, gain: 0.74, send: 0.32 },
    { name: 'Double Basses', instrumentId: 'double-bass', pan: 0.62, gain: 0.76, send: 0.28 },
] as const;

describe('String Orchestra template', () => {
    it('publishes five persisted Levain sections through the registered template', async () => {
        const template = getTemplates().find((entry) => entry.id === 'string-orchestra');
        expect(template).toMatchObject({ name: 'String Orchestra', category: 'film', executionBoundary: 'app-action' });
        expect(
            await handleCreateProjectFromTemplate.execute({
                type: 'createProjectFromTemplate',
                payload: { templateId: 'string-orchestra' },
            })
        ).toEqual({ status: 'written' });

        const tracks = trackStore.value?.tracks ?? [];
        const arrangementTracks = arrangementStore.value?.arrangements[0]?.tracks.tracks ?? [];
        expect(arrangementTracks.map((track) => track.id)).toEqual(tracks.map((track) => track.id));

        const master = tracks.find((track) => track.kind === 'master');
        const strings = tracks.find((track) => track.name === 'Strings');
        const hall = tracks.find((track) => track.name === 'Hall Reverb');
        expect(master?.outputId).toBe('hw_out');
        expect(strings).toMatchObject({ kind: 'bus', outputId: master?.id });
        expect(hall).toMatchObject({ kind: 'bus', outputId: master?.id });
        expect(hall?.devices).toMatchObject([{ type: 'builtin-reverb', parameterValues: { 'rev-mix': 1 } }]);

        const sections = tracks.filter((track) => track.kind === 'midi');
        expect(sections).toHaveLength(5);
        for (const [index, expected] of expectedSections.entries()) {
            const section = sections[index];
            expect(section).toMatchObject({
                name: expected.name,
                pan: expected.pan,
                gain: expected.gain,
                outputId: strings?.id,
                sends: [{ busId: hall?.id, level: expected.send, preFader: false }],
            });
            expect(section?.devices).toHaveLength(1);
            expect(section?.devices[0]).toMatchObject({
                type: 'levain',
                deviceState: {
                    version: 1,
                    data: { instrumentId: expected.instrumentId, currentArticulation: 'sustain' },
                },
            });
        }

        const reopened = sanitizeTrackSnapshot({
            tracks: hydrateArrangementTracks(serializeArrangementTracks(tracks)),
            selectedTrackId: null,
        }).tracks;
        trackStore.set({ tracks: reopened, selectedTrackId: null });
        for (const expected of expectedSections) {
            const section = reopened.find((track) => track.name === expected.name);
            const device = section?.devices[0];
            expect(section).toMatchObject({
                pan: expected.pan,
                outputId: strings?.id,
                sends: [{ busId: hall?.id, level: expected.send }],
            });
            expect(nativeBankKeyForLevainDeviceState({ deviceState: device?.deviceState })).toBe(
                `levain:${expected.instrumentId}`
            );
            expect(hydrateLevainStateFromProject(device?.id ?? '')?.patch).toMatchObject({
                instrumentId: expected.instrumentId,
                currentArticulation: 'sustain',
            });
        }
    });
});
