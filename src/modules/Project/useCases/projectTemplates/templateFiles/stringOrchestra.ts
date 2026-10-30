import { createLevainTemplateDeviceState } from '#/modules/Levain/useCases';

import { addSend } from '../templateHelpers/addSend';
import { createBus } from '../templateHelpers/createBus';
import { createInstrumentTrack } from '../templateHelpers/createInstrumentTrack';
import { finalizeTemplate } from '../templateHelpers/finalizeTemplate';
import { initProject } from '../templateHelpers/initProject';

const sections = [
    { name: 'Violins I', instrumentId: 'violin-1', pan: -30, gain: 0.72, send: 0.38 },
    { name: 'Violins II', instrumentId: 'violin-2', pan: -15, gain: 0.7, send: 0.36 },
    { name: 'Violas', instrumentId: 'viola', pan: 5, gain: 0.72, send: 0.34 },
    { name: 'Cellos', instrumentId: 'cello', pan: 19, gain: 0.74, send: 0.32 },
    { name: 'Double Basses', instrumentId: 'double-bass', pan: 31, gain: 0.76, send: 0.28 },
] as const;

export async function createStringOrchestraTemplate(): Promise<void> {
    const master = initProject({ name: 'String Orchestra', bpm: 96, timeSig: [4, 4], loopEnd: 64 });
    const strings = createBus({ name: 'Strings', devices: [], gain: 0.8 });
    const hall = createBus({
        name: 'Hall Reverb',
        devices: [
            {
                type: 'builtin-reverb',
                name: 'Hall',
                params: { 'rev-size': 0.9, 'rev-decay': 4.5, 'rev-damping': 0.3, 'rev-mix': 1 },
            },
        ],
    });

    const sectionTracks = sections.map((section) => {
        const track = createInstrumentTrack({
            name: section.name,
            deviceType: 'levain',
            deviceName: section.name,
            pan: section.pan,
            gain: section.gain,
        });
        track.devices[0]!.deviceState = createLevainTemplateDeviceState(section.instrumentId);
        track.outputId = strings.id;
        addSend({ from: track, to: hall, level: section.send });
        return track;
    });

    await finalizeTemplate({ tracks: [master, strings, hall, ...sectionTracks], selectTrackId: sectionTracks[0]?.id });
}
