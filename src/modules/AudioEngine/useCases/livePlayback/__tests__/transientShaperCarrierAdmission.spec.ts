import { describe, expect, it } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { type LiveGraphProgramme } from '../projectLiveGraphProgramme';
import { projectLiveGraphTopology } from '../projectLiveGraphTopology';
import { projectStripCarriers } from '../stripCarriers';

const shaper: Device = {
    id: 'shaper',
    name: 'Transient Shaper',
    type: 'transient-shaper',
    bypassed: false,
    parameterValues: { attackGain: 1.5, sustainGain: 0.5 },
};
const plugin: Device = {
    id: 'plugin',
    name: 'Native fixture',
    type: 'external-plugin',
    bypassed: false,
    parameterValues: {},
    externalPluginId: 'clap:test',
    externalInstanceId: 'attached',
};
const playback = {
    trackId: 'audio',
    source: { sourceId: 'pcm' },
    startTime: 0,
    sourceOffsetSeconds: 0,
    durationSeconds: 1,
    playbackRate: 1,
    gain: 1,
    fade: { microFadeSeconds: 0 },
};
const programme: LiveGraphProgramme = {
    playbacksByStripId: new Map([['audio', [playback]]]),
    bakedStripIds: new Set(),
    webVoicedStripIds: new Set(),
    exclusions: [],
};
function project(tracks: Track[], attached = new Set(['attached'])) {
    const input = {
        stripTracks: tracks,
        projectTracks: tracks,
        attachedInstanceIds: attached,
        programme,
        inputMonitoredTrackIds: new Set<string>(),
    };
    return {
        carriers: projectStripCarriers(input),
        commands: projectLiveGraphTopology({
            ...input,
            soloGatedTrackIds: new Set(),
            vcaMultiplierByTrackId: new Map(),
            transport: { playing: true, positionSeconds: 0 },
            monitor: 'audible',
            masterGain: 1,
        }),
    };
}

describe('Transient Shaper native carrier admission', () => {
    it('keeps attached native-only plugin chains representable in both orders across own, output and send routes', () => {
        for (const order of [
            [shaper, plugin],
            [plugin, shaper],
        ]) {
            for (const placement of ['own', 'output', 'send']) {
                const audio = {
                    ...createTrack({ id: 'audio', name: 'Drums', kind: 'audio' }),
                    outputId: placement === 'output' ? 'bus' : 'hw_out',
                    devices: placement === 'own' ? order : [plugin],
                };
                const bus = {
                    ...createTrack({ id: 'bus', name: 'Bus', kind: 'bus' }),
                    outputId: 'hw_out',
                    devices: placement === 'own' ? [] : [shaper],
                };
                if (placement === 'send') audio.sends = [{ busId: 'bus', level: 0.5, preFader: false }];
                const { carriers, commands } = project([audio, bus]);
                expect(carriers.get('audio')).toEqual({ carrier: 'native' });
                const strip = commands.find(
                    (command) => command.kind === 'create-track-strip' && command.trackId === 'audio'
                );
                expect(strip).toMatchObject({ contributesAudio: true });
                expect(commands).toContainEqual(expect.objectContaining({ kind: 'schedule-clip', playback }));
                const deviceRecords = commands.flatMap((command) =>
                    command.kind === 'create-track-strip' || command.kind === 'create-bus-strip' ? command.devices : []
                );
                expect(deviceRecords.find((device) => device.type === 'transient-shaper')).toMatchObject({
                    parameterValues: { attackGain: 1.5, sustainGain: 0.5 },
                });
            }
        }
    });
    it('projects persisted, restored, Undo/Redo and relinked records through the same canonical body', () => {
        const audio = {
            ...createTrack({ id: 'audio', name: 'Drums', kind: 'audio' }),
            devices: [plugin, shaper],
            outputId: 'hw_out',
        };
        const saved: Track = JSON.parse(JSON.stringify(audio));
        for (const devices of [
            saved.devices,
            [plugin],
            saved.devices,
            [
                { ...plugin, externalInstanceId: 'relinked' },
                { ...shaper, bypassed: true },
            ],
        ]) {
            expect(project([{ ...saved, devices }], new Set(['attached', 'relinked'])).carriers.get('audio')).toEqual({
                carrier: 'native',
            });
        }
        expect(project([saved], new Set()).carriers.get('audio')).toMatchObject({ carrier: 'web' });
    });
    it('retains existing monitoring and unrelated web-only obstructions', () => {
        const audio = {
            ...createTrack({ id: 'audio', name: 'Drums', kind: 'audio' }),
            devices: [shaper, { ...shaper, id: 'web', type: 'builtin-filter' }],
        };
        expect(project([audio]).carriers.get('audio')).toMatchObject({ carrier: 'web' });
        expect(
            projectStripCarriers({
                stripTracks: [{ ...audio, devices: [shaper] }],
                projectTracks: [audio],
                programme,
                attachedInstanceIds: new Set(),
                inputMonitoredTrackIds: new Set(['audio']),
            }).get('audio')
        ).toMatchObject({ carrier: 'web' });
    });
});
