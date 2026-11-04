import { createTrack, getTrackStoreState, setDeviceState, setTrackState } from '#/modules/Arrangement/useCases';
import { createLevainTemplateDeviceState } from '#/modules/Levain/useCases';

import { addDeviceChain } from '../templateHelpers/addDeviceChain';
import { addSend } from '../templateHelpers/addSend';
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
    const strings = createTrack({ name: 'Strings', kind: 'bus' });
    strings.gain = 0.8;
    const hall = createTrack({ name: 'Hall Reverb', kind: 'bus' });
    addDeviceChain(hall, [
        {
            type: 'builtin-reverb',
            name: 'Hall',
            params: { 'rev-size': 0.9, 'rev-decay': 4.5, 'rev-damping': 0.3, 'rev-mix': 1 },
        },
    ]);

    const sectionTracks = sections.map((section) => {
        const track = createInstrumentTrack({
            name: section.name,
            deviceType: 'levain',
            deviceName: section.name,
            pan: section.pan,
            gain: section.gain,
        });
        track.outputId = strings.id;
        addSend({ from: track, to: hall, level: section.send });
        return { section, track };
    });
    const selectTrackId = sectionTracks[0]?.track.id ?? null;

    // The sections' instrument identity must reach project truth before
    // `finalizeTemplate` registers the devices: registration rehydrates a Levain
    // from this state, so writing it afterwards would decode the default bank
    // first and reload each section on the reconcile that follows the commit.
    setTrackState({
        tracks: [master, strings, hall, ...sectionTracks.map(({ track }) => track)],
        selectedTrackId: selectTrackId,
    });

    for (const { section, track } of sectionTracks) {
        const device = track.devices[0];
        if (device === undefined) {
            throw new Error(`The "${section.name}" section has no device to carry its Levain state.`);
        }
        if (!setDeviceState({ deviceId: device.id, state: createLevainTemplateDeviceState(section.instrumentId) })) {
            throw new Error(`The "${section.name}" section is missing from the committed track state.`);
        }
    }

    const committedTracks = getTrackStoreState()?.tracks;
    if (committedTracks === undefined) {
        throw new Error('The String Orchestra tracks were not committed.');
    }
    await finalizeTemplate({ tracks: committedTracks, selectTrackId });
}
