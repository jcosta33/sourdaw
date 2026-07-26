import { describe, expect, it } from 'vitest';

import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';

import { isHydratableProjectData } from '../../../projectPersistence/helpers/isHydratableProjectData';
import { createMyceliumAscendantBlueprint } from '../createMyceliumAscendantBlueprint';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PAD_NAMES = [
    'Kick',
    'Snare',
    'Closed HH',
    'Open HH',
    'Clap',
    'Rim',
    'Low Tom',
    'Mid Tom',
    'Hi Tom',
    'Crash',
    'Ride',
    'Cowbell',
    'Clave',
    'Shaker',
    'Perc 1',
    'Perc 2',
] as const;
describe('createMyceliumTopology', () => {
    it('creates the exact 43-track hierarchy with deterministic full ids', () => {
        const { projectData } = createMyceliumAscendantBlueprint();
        const tracks = projectData.arrangement.tracks;
        const ids = tracks.flatMap((track) => [
            track.id,
            track.activeAlternativeId,
            ...track.devices.map((device) => device.id),
        ]);
        ids.push(...(projectData.sidechainRoutes?.map((route) => route.id) ?? []));
        expect(tracks).toHaveLength(43);
        expect(tracks.map((track) => track.name)).toEqual([
            'Master',
            'Pulse Engine',
            ...PAD_NAMES,
            'Bass Mutation',
            'Sub Mycelium',
            'Rolling Colony',
            'Acid Tendril',
            'Fractal Synthesis',
            'Triplet Helix',
            'Psy Pluck',
            'Main Vision',
            'Counter Vision',
            'Harmonic Mist',
            'FM Spores',
            'Organic Signals',
            'Levain Call',
            'Levain Answer',
            'Grand Boule Ritual',
            'Atmospheres & FX',
            'Root Drone',
            'Granular Voices',
            'Fractal Riser',
            'Impact Field',
            'Glitch Spirits',
            'Temple Chamber',
            'Dub Tunnel',
            'Mutation Return',
            'Parallel Crush',
        ]);
        expect(ids.every((id) => UUID_PATTERN.test(id))).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
        for (const [folderName, childNames] of [
            ['Bass Mutation', ['Sub Mycelium', 'Rolling Colony', 'Acid Tendril']],
            [
                'Fractal Synthesis',
                ['Triplet Helix', 'Psy Pluck', 'Main Vision', 'Counter Vision', 'Harmonic Mist', 'FM Spores'],
            ],
            ['Organic Signals', ['Levain Call', 'Levain Answer', 'Grand Boule Ritual']],
            ['Atmospheres & FX', ['Root Drone', 'Granular Voices', 'Fractal Riser', 'Impact Field', 'Glitch Spirits']],
        ] as const) {
            const folder = tracks.find((track) => track.name === folderName);
            expect(tracks.filter((track) => track.parentId === folder?.id).map((track) => track.name)).toEqual(
                childNames
            );
        }
        expect(isHydratableProjectData(projectData)).toBe(true);
    });
    it('builds the 16-child Toaster kit and supported device matrix', () => {
        const tracks = createMyceliumAscendantBlueprint().projectData.arrangement.tracks;
        const pulse = tracks.find((track) => track.name === 'Pulse Engine');
        const pads = tracks.filter((track) => track.parentId === pulse?.id);
        const deviceTypes = new Set(tracks.flatMap((track) => track.devices.map((device) => device.type)));
        const chamberType = tracks.find((track) => track.name === 'Temple Chamber')?.devices[0]?.type;
        expect(pulse?.devices.map((device) => device.type)).toEqual(['toaster']);
        expect(pads.map((track) => track.name)).toEqual(PAD_NAMES);
        expect(
            pads.every((track, index) => track.outputId === pulse?.id && track.notes.includes(`GM note ${36 + index}`))
        ).toBe(true);
        expect(tracks.flatMap((track) => track.devices)).toHaveLength(59);
        expect(getBuiltinPlugins().some((plugin) => plugin.id === chamberType)).toBe(true);
        const requiredFermenterParams = [
            'oscLevel',
            'filterCutoff',
            'filterResonance',
            'lfoRate',
            'lfoFilterAmount',
            'lfoPitchAmount',
            'filterEnvAmount',
            'msegToFilter',
            'unisonSpread',
            'fmLevel2',
            'fmFeedback',
            'noiseLevel',
            'grainDensity',
            'grainSize',
            'grainSpray',
        ];
        for (const device of tracks.flatMap((track) => track.devices).filter((device) => device.type === 'fermenter')) {
            expect(requiredFermenterParams.every((id) => id in device.parameterValues)).toBe(true);
        }
        expect(tracks.find((track) => track.name === 'Acid Tendril')?.devices[0]?.parameterValues.filterModel).toBe(5);
        expect(tracks.find((track) => track.name === 'Fractal Riser')?.devices[0]?.parameterValues.filterModel).toBe(5);
        expect(tracks.find((track) => track.name === 'Master')?.devices.map((device) => device.type)).toEqual([
            'builtin-eq',
            'gluten',
            'builtin-stereo-widener',
            'proof',
            'builtin-lufs-meter',
        ]);
        expect(deviceTypes).toEqual(
            new Set([
                'fermenter',
                'toaster',
                'levain',
                'grand-boule',
                'yeast',
                'bacteria',
                'dutch-oven',
                'gluten',
                'proof',
                'builtin-eq',
                'builtin-filter',
                'builtin-delay',
                'builtin-reverb',
                'builtin-chorus',
                'builtin-phaser',
                'builtin-tremolo',
                'builtin-autopan',
                'builtin-distortion',
                'builtin-bitcrusher',
                'builtin-sidechain-compressor',
                'builtin-stereo-widener',
                'builtin-lufs-meter',
                'builtin-compressor',
            ])
        );
    });
    it('creates a closed routing graph with four returns and one kick sidechain', () => {
        const { projectData } = createMyceliumAscendantBlueprint();
        const tracks = projectData.arrangement.tracks;
        const byId = new Map(tracks.map((track) => [track.id, track]));
        const masterId = tracks.find((track) => track.name === 'Master')?.id;
        const pulseId = tracks.find((track) => track.name === 'Pulse Engine')?.id;
        const returns = tracks.filter((track) => track.kind === 'bus');
        const route = projectData.sidechainRoutes?.[0];
        expect(returns.map((track) => track.name)).toEqual([
            'Temple Chamber',
            'Dub Tunnel',
            'Mutation Return',
            'Parallel Crush',
        ]);
        expect(byId.get(masterId ?? '')?.outputId).toBe('hw_out');
        expect(
            tracks
                .filter((track) => track.kind !== 'master')
                .every((track) => track.outputId === (track.parentId === pulseId ? pulseId : masterId))
        ).toBe(true);
        expect(
            tracks.flatMap((track) => track.sends).every((send) => returns.some((track) => track.id === send.busId))
        ).toBe(true);
        expect(projectData.sidechainRoutes).toHaveLength(1);
        expect([
            returns[0]?.devices.at(-1)?.parameterValues.mix,
            returns[1]?.devices.at(-1)?.parameterValues['delay-mix'],
            returns[2]?.devices.at(-1)?.parameterValues['crush-mix'],
            returns[3]?.devices.at(-1)?.parameterValues['dist-mix'],
        ]).toEqual([1, 1, 1, 1]);
        expect(byId.get(route?.sourceTrackId ?? '')?.name).toBe('Kick');
        expect(byId.get(route?.targetTrackId ?? '')?.name).toBe('Rolling Colony');
        expect(
            byId.get(route?.targetTrackId ?? '')?.devices.some((device) => device.id === route?.targetDeviceId)
        ).toBe(true);
    });

    it('uses bundled synthesis only without Crumbs or external audio assets', () => {
        const { projectData } = createMyceliumAscendantBlueprint();
        const clips = projectData.arrangement.tracks.flatMap((track) => track.clips);
        const deviceTypes = projectData.arrangement.tracks.flatMap((track) =>
            track.devices.map((device) => device.type)
        );

        expect(projectData.audioBuffers ?? {}).toEqual({});
        expect(clips.every((clip) => clip.type === 'midi')).toBe(true);
        expect(
            clips.every(
                (clip) =>
                    clip.bufferId === undefined && clip.audioBufferId === undefined && clip.assetHash === undefined
            )
        ).toBe(true);
        expect(deviceTypes).not.toContain('crumbs');
    });
});
