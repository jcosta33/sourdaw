import { afterEach, describe, expect, it } from 'vitest';

import { arrangementStore } from '../../../../stores/arrangementStore';
import { defaultProjectStoreState, projectStore } from '../../../../stores/projectStore';
import { buildProjectData } from '../../../projectPersistence/fileIO/buildProjectData';
import { hydrateArrangementStoreFromProjectData } from '../../../projectPersistence/helpers/hydrateArrangementStoreFromProjectData';
import { hydrateModuleStoresFromProjectData } from '../../../projectPersistence/helpers/hydrateModuleStoresFromProjectData';
import { isHydratableProjectData } from '../../../projectPersistence/helpers/isHydratableProjectData';
import { resetModuleStoresToDefault } from '../../../projectPersistence/helpers/resetModuleStoresToDefault';
import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';
import { createMyceliumId, type MyceliumIdNamespace } from '../createMyceliumId';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
    resetModuleStoresToDefault();
    projectStore.set(defaultProjectStoreState);
});

describe('createMyceliumAscendantBlueprint', () => {
    it('creates the transport contract', () => {
        const { projectData } = createMyceliumAscendantBlueprint();

        expect(projectData.meta).toMatchObject({
            name: 'Mycelium Ascendant',
            keyRoot: 9,
            scaleName: 'harmonic-minor',
        });
        expect(projectData.transport).toMatchObject({
            tempo: 144,
            timeSignatureNumerator: 4,
            timeSignatureDenominator: 4,
            loopStart: 0,
            loopEnd: 576,
            isLooping: true,
            preRollEnabled: false,
            preRollBars: 1,
            masterGain: 100,
        });
        expect(projectData.tempoMap?.changes.map(({ beat, tempo, curve }) => [beat, tempo, curve])).toEqual([
            [0, 144, 'instant'],
            [352, 144, 'linear'],
            [416, 146, 'instant'],
            [544, 146, 'linear'],
            [576, 144, 'instant'],
        ]);
        expect(
            projectData.timeSignatureMap?.changes.map(({ beat, numerator, denominator }) => [
                beat,
                numerator,
                denominator,
            ])
        ).toEqual([
            [0, 4, 4],
            [288, 7, 8],
            [316, 4, 4],
        ]);
    });

    it('creates sections and cue markers at the specified beats', () => {
        const blueprint = createMyceliumAscendantBlueprint();

        expect(blueprint.sections.map(({ name, startBeat, endBeat }) => [name, startBeat, endBeat])).toEqual([
            ['Sporefall', 0, 64],
            ['First Germination', 64, 128],
            ['Pressure Bloom', 128, 192],
            ['Drop I — Hyphal Drive', 192, 288],
            ['Psilocybin Chapel', 288, 352],
            ['Singularity Build', 352, 416],
            ['Drop II — Fractal Bloom', 416, 544],
            ['Dissolution', 544, 576],
        ]);
        expect(blueprint.projectData.markers.map(({ name, beat }) => [name, beat])).toEqual([
            ['Sporefall', 0],
            ['Pulse Emerges', 48],
            ['First Germination', 64],
            ['Pressure Bloom', 128],
            ['Vacuum I', 188],
            ['Drop I — Hyphal Drive', 192],
            ['Psilocybin Chapel', 288],
            ['Grid Restored', 316],
            ['Singularity Build', 352],
            ['Vacuum II', 412],
            ['Drop II — Fractal Bloom', 416],
            ['False Floor', 480],
            ['Return Strike', 484],
            ['Dissolution', 544],
            ['Last Signal', 568],
        ]);
    });

    it('creates the complete repeating harmonic cycle', () => {
        const { chordEvents, projectData } = createMyceliumAscendantBlueprint();

        expect(projectData.chordTrack).toEqual({ enabled: true, events: chordEvents });
        expect(chordEvents).toHaveLength(36);
        expect(
            chordEvents.slice(0, 4).map(({ beat, root, quality, duration }) => [beat, root, quality, duration])
        ).toEqual([
            [0, 4, '7', 16],
            [16, 5, 'maj7', 16],
            [32, 2, 'min9', 16],
            [48, 9, 'min9', 16],
        ]);
        expect(chordEvents.at(-1)).toMatchObject({ beat: 560, root: 9, quality: 'min9', duration: 16 });
    });

    it('is serializable, structurally deterministic, and includes the final automation choreography', () => {
        const first = createMyceliumAscendantBlueprint();
        const second = createMyceliumAscendantBlueprint();
        const tempoIds = first.projectData.tempoMap?.changes.flatMap((change) => change.id ?? []) ?? [];
        const meterIds = first.projectData.timeSignatureMap?.changes.flatMap((change) => change.id ?? []) ?? [];
        const ids = [
            ...(first.projectData.activeArrangementId ? [first.projectData.activeArrangementId] : []),
            ...first.sections.map((section) => section.id),
            ...first.chordEvents.map((chord) => chord.id),
            ...first.projectData.markers.map((marker) => marker.id),
            ...tempoIds,
            ...meterIds,
        ];
        const activeArrangement = first.projectData.arrangements?.find(
            (arrangement) => arrangement.id === first.projectData.activeArrangementId
        );

        expect(first).toEqual(second);
        expect(JSON.parse(JSON.stringify(first))).toEqual(first);
        expect(ids.every((id) => UUID_PATTERN.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
        expect(first.projectData.arrangement.tracks.some((track) => track.clips.length > 0)).toBe(true);
        expect(Object.keys(first.projectData.midi.notesByClipId).length).toBeGreaterThan(0);
        expect(first.projectData.automation.lanes).toHaveLength(115);
        expect(activeArrangement?.automation).toEqual(first.projectData.automation);
        expect(activeArrangement?.tracks?.tracks).toEqual(first.projectData.arrangement.tracks);
    });

    it('preserves sections through validation, import hydration, save, and reload', async () => {
        const blueprint = createMyceliumAscendantBlueprint();
        const imported = structuredClone(blueprint.projectData);

        expect(isHydratableProjectData(imported)).toBe(true);
        if (!isHydratableProjectData(imported)) {
            throw new Error('Mycelium blueprint did not pass the canonical project validator');
        }

        hydrateArrangementStoreFromProjectData({ data: imported, preserveSavedArrangements: true });
        hydrateModuleStoresFromProjectData(imported);
        projectStore.set({
            ...defaultProjectStoreState,
            ...imported.meta,
            dirty: false,
            loading: false,
            initialized: true,
        });

        const importedActive = arrangementStore.value?.arrangements.find(
            (arrangement) => arrangement.id === arrangementStore.value?.activeArrangementId
        );
        expect(importedActive?.id).toBe(imported.activeArrangementId);
        expect(importedActive?.markers?.sections).toEqual(blueprint.sections);

        const saved = await buildProjectData({ includeAudioBuffers: false });
        expect(saved?.data.arrangements?.[0]?.markers?.sections).toEqual(blueprint.sections);
        expect(saved?.data.chordTrack).toEqual(blueprint.projectData.chordTrack);
        expect(saved?.data.midi.notesByClipId).toMatchObject(blueprint.projectData.midi.notesByClipId);
        expect(saved?.data.arrangements?.[0]?.midi?.notesByClipId).toEqual(saved?.data.midi.notesByClipId);
        const reloaded = structuredClone(saved?.data);
        expect(isHydratableProjectData(reloaded)).toBe(true);
        if (!isHydratableProjectData(reloaded)) {
            throw new Error('Saved Mycelium blueprint did not pass the canonical project validator');
        }

        resetModuleStoresToDefault();
        hydrateArrangementStoreFromProjectData({ data: reloaded, preserveSavedArrangements: true });
        const reloadedActive = arrangementStore.value?.arrangements.find(
            (arrangement) => arrangement.id === arrangementStore.value?.activeArrangementId
        );
        expect(reloadedActive?.id).toBe(blueprint.projectData.activeArrangementId);
        expect(reloadedActive?.markers?.sections).toEqual(blueprint.sections);
    });

    it('isolates ids across future content namespaces', () => {
        const namespaces: MyceliumIdNamespace[] = [
            'track',
            'device',
            'rhythm-clip',
            'rhythm-note',
            'voice-clip',
            'voice-note',
            'automation',
        ];
        const ids = namespaces.map((namespace) => createMyceliumId(namespace, 'shared-key'));

        expect(ids.every((id) => UUID_PATTERN.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(namespaces.length);
        expect(createMyceliumId('rhythm-clip', 'kick:drop-one')).toBe(createMyceliumId('rhythm-clip', 'kick:drop-one'));
    });
});
