import { afterEach, describe, expect, it } from 'vitest';

import { transportStore } from '#/modules/Transport/stores';

import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { buildProjectData } from '../../../projectPersistence/fileIO/buildProjectData';
import { resetModuleStoresToDefault } from '../../../projectPersistence/helpers/resetModuleStoresToDefault';
import { createMyceliumAscendantDemo } from '../createMyceliumAscendantDemo';

afterEach(() => {
    resetModuleStoresToDefault();
    projectStore.set(defaultProjectStoreState);
});

describe('createMyceliumAscendantDemo', () => {
    it('hydrates the complete launchable project into canonical stores', async () => {
        createMyceliumAscendantDemo();

        expect(projectStore.value).toMatchObject({
            name: 'Mycelium Ascendant',
            loading: true,
            initialized: false,
            keyRoot: 9,
            scaleName: 'harmonicMinor',
        });
        expect(transportStore.value).toMatchObject({
            tempo: 144,
            loopStart: 0,
            loopEnd: 576,
            isLooping: true,
            masterGain: 100,
        });

        const built = await buildProjectData({ includeAudioBuffers: false });
        if (!built) {
            throw new Error('Mycelium launch did not hydrate a buildable project');
        }
        const data = built.data;
        const activeArrangement = data.arrangements?.find((arrangement) => arrangement.id === data.activeArrangementId);
        const clipCount = data.arrangement.tracks.reduce((total, track) => total + track.clips.length, 0);
        const noteCount = Object.values(data.midi.notesByClipId).reduce((total, notes) => total + notes.length, 0);

        expect(data.arrangement.tracks).toHaveLength(43);
        expect(clipCount).toBe(119);
        expect(noteCount).toBe(3873);
        expect(data.automation.lanes).toHaveLength(115);
        expect(data.sidechainRoutes).toHaveLength(1);
        expect(activeArrangement?.markers?.sections).toHaveLength(8);
        expect(activeArrangement?.tracks?.tracks).toEqual(data.arrangement.tracks);
        expect(activeArrangement?.automation).toEqual(data.automation);
        expect(data.arrangement.tracks.some((track) => track.frozen)).toBe(false);
    });
});
