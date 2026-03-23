import { addTrack } from '#/modules/Track/useCases/addTrack';
import { addDevice } from '#/modules/Track/useCases/deviceUseCases';
import { trackStore } from '#/modules/Track/stores/trackStore';
import { newProject } from '../projectPersistence';
import { demo1_TheCompleteMix, demo2_ElectronicBeat, demo3_AcousticSession, demo4_NativeShowcase } from '../demoProjects';
import { type TemplateCategory, type ProjectTemplate } from './types';

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
        create: () => {
            void demo1_TheCompleteMix();
        },
    },
    {
        id: 'demo-electronic',
        name: 'Psyloops',
        description: 'A 142 BPM psytrance track in A minor with acid bass, supersaw stabs, dual leads, and 8 sections of builds and drops.',
        category: 'demo',
        create: () => {
            void demo2_ElectronicBeat();
        },
    },
    {
        id: 'demo-acoustic',
        name: 'Midnight Smoke',
        description: 'A chill 82 BPM jazz track in Eb major with walking bass, Rhodes comping, flute solo, and 7 sections of smooth exploration.',
        category: 'demo',
        create: () => {
            void demo3_AcousticSession();
        },
    },
    {
        id: 'demo-native-showcase',
        name: 'Brainfeeder (Native Only)',
        description: 'A 50-track Flying Lotus-style experimental beat showcase using native DSP effects. Only available in the native app.',
        category: 'demo',
        platform: 'native',
        create: () => {
            void demo4_NativeShowcase();
        },
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

export function getTemplatesByCategory(category: TemplateCategory): ProjectTemplate[] {
    return templates.filter((t) => t.category === category);
}

export function createFromTemplate(templateId: string): void {
    const template = templates.find((t) => t.id === templateId);
    if (!template) {
        return;
    }
    template.create();
}
