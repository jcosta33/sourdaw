import { trackStore } from '#/modules/Arrangement/stores';
import { addTrack, addDevice } from '#/modules/Arrangement/useCases';

import { demo5_NebulaDrift } from '../../demoProjects/nebulaDrift/createNebulaDriftDemo';
import { demo1_TheCompleteMix } from '../../demoProjects/resonance/createResonanceDemo';
import { newProject } from '../../projectPersistence/newProject';

export type TemplateCategory = 'empty' | 'music' | 'podcast' | 'film' | 'demo';

export type ProjectTemplate = {
    id: string;
    name: string;
    description: string;
    category: TemplateCategory;
    platform?: 'web' | 'native';
    create: () => void | Promise<void>;
};

export function attachSynthDevice(trackId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const device = {
        // §122.1 — UUID instead of module-level counter that reset on HMR.
        id: `device-synth-${crypto.randomUUID()}`,
        name: 'Synth',
        type: 'synth',
        bypassed: false,
        parameterValues: {},
    };

    trackStore.set({
        ...state,
        tracks: state.tracks.map((t) => (t.id === trackId ? { ...t, devices: [...t.devices, device] } : t)),
    });
}

export const addTrackWithDevices = (
    name: string,
    kind: 'audio' | 'midi',
    devices: string[],
    options?: { withSynth?: boolean }
): void => {
    const track = addTrack({ name, kind });
    if (!track) {
        return;
    }

    if (options?.withSynth) {
        attachSynthDevice(track.id);
    }

    for (const deviceType of devices) {
        addDevice(track.id, deviceType);
    }
};

export const templates: ProjectTemplate[] = [
    {
        id: 'empty',
        name: 'Empty Project',
        description: 'A blank canvas — no tracks, no devices.',
        category: 'empty',
        create: () => {
            newProject('Untitled');
        },
    },
    {
        id: 'basic-band',
        name: 'Basic Band',
        description: 'Drums, bass, guitar, and vocals with EQ on each track.',
        category: 'music',
        create: () => {
            newProject('Basic Band');
            addTrackWithDevices('Drums', 'audio', ['EQ']);
            addTrackWithDevices('Bass', 'midi', ['EQ'], { withSynth: true });
            addTrackWithDevices('Guitar', 'audio', ['EQ']);
            addTrackWithDevices('Vocals', 'audio', ['EQ']);
        },
    },
    {
        id: 'electronic',
        name: 'Electronic',
        description: 'Drums, synth lead, synth pad, and bass — ready for electronic production.',
        category: 'music',
        create: () => {
            newProject('Electronic');
            addTrackWithDevices('Drums', 'audio', ['Compressor']);
            addTrackWithDevices('Synth Lead', 'midi', ['EQ'], { withSynth: true });
            addTrackWithDevices('Synth Pad', 'midi', ['EQ'], { withSynth: true });
            addTrackWithDevices('Bass', 'midi', ['Compressor'], { withSynth: true });
        },
    },
    {
        id: 'podcast',
        name: 'Podcast',
        description: 'Host, guest, and music bed tracks with compressor and EQ.',
        category: 'podcast',
        create: () => {
            newProject('Podcast');
            addTrackWithDevices('Host', 'audio', ['Compressor', 'EQ']);
            addTrackWithDevices('Guest', 'audio', ['Compressor', 'EQ']);
            addTrackWithDevices('Music Bed', 'audio', ['Compressor', 'EQ']);
        },
    },
    {
        id: 'film-score',
        name: 'Film Score',
        description: 'Strings, brass, woodwinds, percussion, and dialog for scoring to picture.',
        category: 'film',
        create: () => {
            newProject('Film Score');
            addTrackWithDevices('Strings', 'midi', ['Reverb'], { withSynth: true });
            addTrackWithDevices('Brass', 'midi', ['Reverb'], { withSynth: true });
            addTrackWithDevices('Woodwinds', 'midi', ['Reverb'], { withSynth: true });
            addTrackWithDevices('Percussion', 'audio', ['EQ']);
            addTrackWithDevices('Dialog', 'audio', ['Compressor', 'EQ']);
        },
    },
    {
        id: 'singer-songwriter',
        name: 'Singer-Songwriter',
        description: 'Acoustic guitar, vocals, and piano — simple and intimate.',
        category: 'music',
        create: () => {
            newProject('Singer-Songwriter');
            addTrackWithDevices('Acoustic Guitar', 'audio', ['EQ']);
            addTrackWithDevices('Vocals', 'audio', ['Compressor', 'EQ']);
            addTrackWithDevices('Piano', 'midi', ['Reverb'], { withSynth: true });
        },
    },
    {
        id: 'demo-complete',
        name: 'Resonance',
        description:
            'A fully arranged 5-minute ambient/IDM production in D minor with 28 tracks, automation, markers, and detailed MIDI patterns.',
        category: 'demo',
        create: () => demo1_TheCompleteMix(),
    },
    {
        id: 'demo-nebula-drift',
        name: 'Nebula Drift',
        description:
            'A ~5-minute Tangerine Dream–style journey: Fermenter drones, pluck/grain textures, Levain lines, Naan Sitar lead, Pullman Organ lead, Rye Reese bass, and a full 16-pad Toaster kit (folder-hosted) with heavy automation and spatial FX.',
        category: 'demo',
        create: () => demo5_NebulaDrift(),
    },
];
