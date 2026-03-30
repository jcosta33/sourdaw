import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { addDevice } from '#/modules/Arrangement/useCases/device/addDevice';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { newProject } from '../projectPersistence';
import {
    demo1_TheCompleteMix,
    demo_SweetDreams,
    demo4_NativeShowcase,
    demo5_NebulaDrift,
} from '../demoProjects';
import { type ProjectTemplate } from '#/modules/Project/models/ProjectTemplateTypes';

let synthDeviceCounter = 0;

const addTrackWithDevices = (
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

function attachSynthDevice(trackId: string): void {
    const state = trackStore.value;
    if (!state) {
        return;
    }

    const device = {
        id: `device-synth-${++synthDeviceCounter}`,
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

function isNativePlatform(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const templates: ProjectTemplate[] = [
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
        id: 'demo-sweet-dreams',
        name: 'Sweet Dreams',
        description: 'A faithful cover of "Sweet Dreams (Are Made of This)" by Eurythmics — showcasing Fermenter synths, Toaster drums, and the full Sourdaw mixing chain.',
        category: 'demo',
        create: () => demo_SweetDreams(),
    },
    {
        id: 'demo-native-showcase',
        name: 'Brainfeeder (Native Only)',
        description: 'A 50-track Flying Lotus-style experimental beat showcase using native DSP effects. Only available in the native app.',
        category: 'demo',
        platform: 'native',
        create: () => demo4_NativeShowcase(),
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

export function getTemplates(): ProjectTemplate[] {
    const native = isNativePlatform();
    return templates.filter((t) => {
        if (t.platform === 'native' && !native) return false;
        if (t.platform === 'web' && native) return false;
        return true;
    });
}

export async function createFromTemplate(templateId: string): Promise<void> {
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
        return;
    }
    await template.create();
}
