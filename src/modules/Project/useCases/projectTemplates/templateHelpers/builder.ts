import { markerStore, grooveStore, vcaGroupStore, trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';
import { chordTrackStore } from '#/modules/MIDI/stores';
import { addSidechainRoute } from '#/modules/Routing/useCases';
import { transportStore, defaultTransportState } from '#/modules/Transport/stores';
import { ensureTrackStrips } from '#/modules/Transport/useCases';

import { projectStore } from '../../../stores/projectStore';
import { syncArrangement } from '../../demoProjects/demoUtils/syncArrangement';

import type { MarkerStoreState, Track } from '#/modules/Arrangement/stores';

type Device = Track['devices'][number];
type Send = Track['sends'][number];

type MarkerRecord = MarkerStoreState['markers'][number];
type SectionRecord = MarkerStoreState['sections'][number];

type ChordQuality =
    | 'major'
    | 'minor'
    | 'dim'
    | 'aug'
    | 'sus2'
    | 'sus4'
    | '7'
    | 'maj7'
    | 'min7'
    | 'dim7'
    | 'aug7'
    | '6'
    | 'min6'
    | '9'
    | 'add9'
    | 'min9'
    | '7sus4';

type DeviceSpec = { type: string; name?: string; params?: Record<string, number> };

type InitProjectInput = {
    name: string;
    bpm: number;
    timeSig?: [number, number];
    keyRoot?: number;
    scaleName?: string;
    loopEnd?: number;
};

export function initProject(input: InitProjectInput): Track {
    const timeSigNum = input.timeSig?.[0] ?? 4;
    const timeSigDen = input.timeSig?.[1] ?? 4;

    trackStore.set({ tracks: [], selectedTrackId: null });
    chordTrackStore.set({ enabled: false, events: [] });
    markerStore.set({ markers: [], sections: [] });
    vcaGroupStore.set({ groups: [] });

    transportStore.set({
        ...defaultTransportState,
        tempo: input.bpm,
        timeSignatureNumerator: timeSigNum,
        timeSignatureDenominator: timeSigDen,
        loopEnd: input.loopEnd ?? 64,
        isLooping: true,
    });

    projectStore.set({
        name: input.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        dirty: false,
        loading: false,
        initialized: true,
        keyRoot: input.keyRoot ?? 0,
        scaleName: input.scaleName ?? 'chromatic',
        tuning: {
            name: 'Equal Temperament',
            frequencies: Array.from({ length: 128 }, (_, noteIndex) => 440 * 2 ** ((noteIndex - 69) / 12)),
        },
    });

    return createTrack({ name: 'Master', kind: 'master' });
}

type SetGrooveInput = {
    id: string;
    name: string;
    offsets: number[];
    resolution: number;
    intensity: number;
};

export function setGroove(input: SetGrooveInput): void {
    const existing = grooveStore.value?.templates ?? [];
    grooveStore.set({
        templates: [
            ...existing.filter((template) => template.id !== input.id),
            {
                id: input.id,
                name: input.name,
                offsets: input.offsets,
                resolution: input.resolution,
            },
        ],
        projectGrooveId: input.id,
        projectGrooveIntensity: input.intensity,
    });
}

type CreateFolderInput = {
    name: string;
    color?: string;
    collapsed?: boolean;
    parentId?: string;
};

export function createFolder(input: CreateFolderInput): Track {
    const folder = createTrack({ name: input.name, kind: 'folder', parentId: input.parentId });
    if (input.color !== undefined) {
        folder.color = input.color;
    }
    if (input.collapsed !== undefined) {
        folder.collapsed = input.collapsed;
    }
    return folder;
}

function buildDevice(spec: DeviceSpec): Device {
    return {
        id: `dev-${crypto.randomUUID()}`,
        name: spec.name ?? spec.type,
        type: spec.type,
        bypassed: false,
        parameterValues: spec.params ?? {},
    };
}

type CreateInstrumentTrackInput = {
    name: string;
    parentId?: string;
    deviceType: string;
    deviceName?: string;
    deviceParams?: Record<string, number>;
    extraDevices?: DeviceSpec[];
    color?: string;
    gain?: number;
    pan?: number;
};

export function createInstrumentTrack(input: CreateInstrumentTrackInput): Track {
    const track = createTrack({ name: input.name, kind: 'midi', parentId: input.parentId });
    const instrument = buildDevice({
        type: input.deviceType,
        name: input.deviceName ?? input.name,
        params: input.deviceParams,
    });
    const extras = (input.extraDevices ?? []).map(buildDevice);
    track.devices = [instrument, ...extras];
    if (input.color !== undefined) {
        track.color = input.color;
    }
    if (input.gain !== undefined) {
        track.gain = input.gain;
    }
    if (input.pan !== undefined) {
        track.pan = input.pan;
    }
    return track;
}

type CreateAudioTrackInput = {
    name: string;
    parentId?: string;
    devices?: DeviceSpec[];
    color?: string;
    gain?: number;
    pan?: number;
};

export function createAudioTrack(input: CreateAudioTrackInput): Track {
    const track = createTrack({ name: input.name, kind: 'audio', parentId: input.parentId });
    track.devices = (input.devices ?? []).map(buildDevice);
    if (input.color !== undefined) {
        track.color = input.color;
    }
    if (input.gain !== undefined) {
        track.gain = input.gain;
    }
    if (input.pan !== undefined) {
        track.pan = input.pan;
    }
    return track;
}

type CreateBusInput = {
    name: string;
    devices: DeviceSpec[];
    color?: string;
    gain?: number;
};

export function createBus(input: CreateBusInput): Track {
    const bus = createTrack({ name: input.name, kind: 'bus' });
    bus.devices = input.devices.map(buildDevice);
    if (input.color !== undefined) {
        bus.color = input.color;
    }
    if (input.gain !== undefined) {
        bus.gain = input.gain;
    }
    return bus;
}

export function addDeviceChain(track: Track, devices: DeviceSpec[]): void {
    const additions = devices.map(buildDevice);
    track.devices = [...track.devices, ...additions];
}

type AddSendInput = {
    from: Track;
    to: Track;
    level: number;
    preFader?: boolean;
};

export function addSend(input: AddSendInput): void {
    const send: Send = {
        busId: input.to.id,
        level: input.level,
        preFader: input.preFader ?? false,
    };
    input.from.sends = [...input.from.sends.filter((existingSend) => existingSend.busId !== input.to.id), send];
}

type AttachSidechainCompressorInput = {
    track: Track;
    name?: string;
    threshold?: number;
    ratio?: number;
    attack?: number;
    release?: number;
    knee?: number;
    makeup?: number;
};

export function attachSidechainCompressor(input: AttachSidechainCompressorInput): string {
    const deviceId = `dev-${crypto.randomUUID()}`;
    const device: Device = {
        id: deviceId,
        name: input.name ?? 'SC Comp',
        type: 'builtin-sidechain-compressor',
        bypassed: false,
        parameterValues: {
            'sc-comp-threshold': input.threshold ?? -24,
            'sc-comp-ratio': input.ratio ?? 4,
            'sc-comp-attack': input.attack ?? 5,
            'sc-comp-release': input.release ?? 180,
            'sc-comp-knee': input.knee ?? 6,
            'sc-comp-makeup': input.makeup ?? 2,
        },
    };
    input.track.devices = [...input.track.devices, device];
    return deviceId;
}

type VcaGroupHandle = {
    id: string;
    name: string;
    memberTrackIds: string[];
};

type CreateVcaInput = {
    name: string;
    members?: Track[];
};

export function createVca(input: CreateVcaInput): VcaGroupHandle {
    const id = `vca-${crypto.randomUUID().slice(0, 8)}`;
    const handle: VcaGroupHandle = {
        id,
        name: input.name,
        memberTrackIds: (input.members ?? []).map((track) => track.id),
    };
    return handle;
}

export function commitVcaGroups(handles: VcaGroupHandle[], allTracks: Track[]): void {
    vcaGroupStore.set({
        groups: handles.map((handle) => ({
            id: handle.id,
            name: handle.name,
            gain: 1,
            muted: false,
            trackIds: handle.memberTrackIds,
        })),
    });
    for (const handle of handles) {
        for (const memberId of handle.memberTrackIds) {
            const member = allTracks.find((track) => track.id === memberId);
            if (member) {
                member.vcaGroupId = handle.id;
            }
        }
    }
}

type ChordSpec = { root: number; quality: ChordQuality; duration: number };

type SetChordProgressionInput = {
    chords: ChordSpec[];
    repeatUntilBeat: number;
};

export function setChordProgression(input: SetChordProgressionInput): void {
    if (input.chords.length === 0) {
        chordTrackStore.set({ enabled: true, events: [] });
        return;
    }
    const events = [];
    let beat = 0;
    let progressionIndex = 0;
    while (beat < input.repeatUntilBeat) {
        const chord = input.chords[progressionIndex % input.chords.length]!;
        const duration = Math.min(chord.duration, input.repeatUntilBeat - beat);
        events.push({
            id: `chord-${crypto.randomUUID().slice(0, 8)}`,
            beat,
            root: chord.root % 12,
            quality: chord.quality,
            duration,
        });
        beat += chord.duration;
        progressionIndex += 1;
    }
    chordTrackStore.set({ enabled: true, events });
}

type MarkerInput = { beat: number; name: string; color?: string };

export function addMarkers(markers: MarkerInput[]): void {
    const existing = markerStore.value ?? { markers: [], sections: [] };
    const defaultColor = 'oklch(0.38 0.08 270)';
    const newMarkers: MarkerRecord[] = markers.map((marker) => ({
        id: crypto.randomUUID(),
        beat: marker.beat,
        name: marker.name,
        color: marker.color ?? defaultColor,
    }));
    markerStore.set({
        markers: [...existing.markers, ...newMarkers],
        sections: existing.sections,
    });
}

type SectionInput = { startBeat: number; endBeat: number; name: string; color?: string };

export function addSections(sections: SectionInput[]): void {
    const existing = markerStore.value ?? { markers: [], sections: [] };
    const defaultColor = 'oklch(0.40 0.07 200)';
    const newSections: SectionRecord[] = sections.map((section) => ({
        id: crypto.randomUUID(),
        startBeat: section.startBeat,
        endBeat: section.endBeat,
        name: section.name,
        color: section.color ?? defaultColor,
    }));
    markerStore.set({
        markers: existing.markers,
        sections: [...existing.sections, ...newSections],
    });
}

type MasterPreset = 'pop' | 'hiphop' | 'edm' | 'rock' | 'lofi' | 'cinematic' | 'podcast' | 'songwriter' | 'ambient';

const MASTER_CHAIN_PRESETS: Record<MasterPreset, DeviceSpec[]> = {
    pop: [
        {
            type: 'builtin-eq',
            name: 'Master EQ',
            params: {
                'eq-low-gain': 1.5,
                'eq-low-freq': 80,
                'eq-low-q': 0.8,
                'eq-mid-gain': 0.5,
                'eq-mid-freq': 2500,
                'eq-mid-q': 1.0,
                'eq-high-gain': 2.0,
                'eq-high-freq': 12000,
                'eq-high-q': 0.7,
            },
        },
        {
            type: 'gluten',
            name: 'Glue Bus Comp',
            params: {
                topology: 3,
                amount: 45,
                threshold: -14,
                ratio: 2,
                attack: 30,
                release: 180,
                knee: 6,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        { type: 'proof', name: 'Proof Mastering', params: { input_gain: 0, output_gain: 0, lim_ceiling: -1 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -10 } },
    ],
    hiphop: [
        {
            type: 'builtin-eq',
            name: 'Master EQ',
            params: {
                'eq-low-gain': 2.5,
                'eq-low-freq': 60,
                'eq-low-q': 0.8,
                'eq-mid-gain': -1.0,
                'eq-mid-freq': 500,
                'eq-mid-q': 1.2,
                'eq-high-gain': 1.5,
                'eq-high-freq': 10000,
                'eq-high-q': 0.7,
            },
        },
        {
            type: 'gluten',
            name: 'Trap Glue',
            params: {
                topology: 3,
                amount: 60,
                threshold: -12,
                ratio: 3,
                attack: 20,
                release: 150,
                knee: 6,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        { type: 'proof', name: 'Proof Mastering', params: { input_gain: 1, output_gain: 0, lim_ceiling: -0.8 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -8 } },
    ],
    edm: [
        {
            type: 'builtin-eq',
            name: 'Master EQ',
            params: {
                'eq-low-gain': 2.0,
                'eq-low-freq': 70,
                'eq-low-q': 0.8,
                'eq-mid-gain': -1.5,
                'eq-mid-freq': 400,
                'eq-mid-q': 1.4,
                'eq-high-gain': 3.0,
                'eq-high-freq': 12000,
                'eq-high-q': 0.7,
            },
        },
        {
            type: 'gluten',
            name: 'EDM Glue',
            params: {
                topology: 3,
                amount: 70,
                threshold: -10,
                ratio: 4,
                attack: 10,
                release: 120,
                knee: 4,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        {
            type: 'builtin-limiter',
            name: 'Brickwall',
            params: { threshold: -0.3, release: 100, ceiling: -0.3 },
        },
        { type: 'proof', name: 'Proof Mastering', params: { input_gain: 0, output_gain: 0, lim_ceiling: -0.3 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -6 } },
    ],
    rock: [
        {
            type: 'builtin-eq',
            name: 'Master EQ',
            params: {
                'eq-low-gain': 1.8,
                'eq-low-freq': 90,
                'eq-low-q': 0.8,
                'eq-mid-gain': 1.0,
                'eq-mid-freq': 2500,
                'eq-mid-q': 1.0,
                'eq-high-gain': 1.5,
                'eq-high-freq': 10000,
                'eq-high-q': 0.7,
            },
        },
        { type: 'bacteria', name: 'Multiband', params: {} },
        {
            type: 'gluten',
            name: 'Glue Bus Comp',
            params: {
                topology: 3,
                amount: 50,
                threshold: -14,
                ratio: 2.5,
                attack: 25,
                release: 180,
                knee: 6,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        { type: 'builtin-limiter', name: 'Brickwall', params: { threshold: -0.5, release: 100, ceiling: -0.5 } },
        { type: 'proof', name: 'Proof Mastering', params: { input_gain: 0, output_gain: 0, lim_ceiling: -0.5 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -9 } },
    ],
    lofi: [
        {
            type: 'builtin-eq',
            name: 'Lo-fi EQ',
            params: {
                'eq-low-gain': 2.0,
                'eq-low-freq': 120,
                'eq-low-q': 0.7,
                'eq-mid-gain': -3.0,
                'eq-mid-freq': 3500,
                'eq-mid-q': 1.0,
                'eq-high-gain': -2.0,
                'eq-high-freq': 9000,
                'eq-high-q': 0.7,
            },
        },
        {
            type: 'builtin-bitcrusher',
            name: 'Subtle Crush',
            params: { 'bitcrusher-bits': 12, 'bitcrusher-rate': 0.8, 'bitcrusher-mix': 0.15 },
        },
        {
            type: 'gluten',
            name: 'Warm Glue',
            params: {
                topology: 2,
                amount: 40,
                threshold: -16,
                ratio: 2,
                attack: 40,
                release: 250,
                knee: 10,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        { type: 'proof', name: 'Proof Warm', params: { input_gain: 0, output_gain: 0, lim_ceiling: -1.5 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -14 } },
    ],
    cinematic: [
        {
            type: 'builtin-eq',
            name: 'Cinema EQ',
            params: {
                'eq-low-gain': 1.0,
                'eq-low-freq': 60,
                'eq-low-q': 0.8,
                'eq-mid-gain': -0.5,
                'eq-mid-freq': 800,
                'eq-mid-q': 1.2,
                'eq-high-gain': 2.0,
                'eq-high-freq': 12000,
                'eq-high-q': 0.6,
            },
        },
        {
            type: 'gluten',
            name: 'Orch Glue',
            params: {
                topology: 1,
                amount: 30,
                threshold: -18,
                ratio: 1.5,
                attack: 50,
                release: 250,
                knee: 10,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        { type: 'proof', name: 'Proof Mastering', params: { input_gain: 0, output_gain: 0, lim_ceiling: -1.5 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -18 } },
    ],
    podcast: [
        {
            type: 'builtin-eq',
            name: 'Broadcast EQ',
            params: {
                'eq-low-gain': -2.0,
                'eq-low-freq': 80,
                'eq-low-q': 0.8,
                'eq-mid-gain': 2.0,
                'eq-mid-freq': 3000,
                'eq-mid-q': 1.0,
                'eq-high-gain': 1.5,
                'eq-high-freq': 10000,
                'eq-high-q': 0.7,
            },
        },
        {
            type: 'gluten',
            name: 'Voice Glue',
            params: {
                topology: 3,
                amount: 35,
                threshold: -18,
                ratio: 2,
                attack: 20,
                release: 150,
                knee: 6,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        { type: 'builtin-limiter', name: 'Broadcast Limit', params: { 'lim-threshold': -2, 'lim-release': 100 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -16 } },
    ],
    songwriter: [
        {
            type: 'builtin-eq',
            name: 'Master EQ',
            params: {
                'eq-low-gain': 1.0,
                'eq-low-freq': 100,
                'eq-low-q': 0.8,
                'eq-mid-gain': 0.5,
                'eq-mid-freq': 2000,
                'eq-mid-q': 1.0,
                'eq-high-gain': 1.5,
                'eq-high-freq': 12000,
                'eq-high-q': 0.7,
            },
        },
        {
            type: 'gluten',
            name: 'Gentle Glue',
            params: {
                topology: 1,
                amount: 35,
                threshold: -16,
                ratio: 2,
                attack: 30,
                release: 200,
                knee: 8,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        { type: 'proof', name: 'Proof Warm', params: { input_gain: 0, output_gain: 0, lim_ceiling: -1 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -14 } },
    ],
    ambient: [
        {
            type: 'builtin-eq',
            name: 'Master EQ',
            params: {
                'eq-low-gain': 0.5,
                'eq-low-freq': 80,
                'eq-low-q': 0.8,
                'eq-mid-gain': -0.5,
                'eq-mid-freq': 600,
                'eq-mid-q': 1.0,
                'eq-high-gain': 2.5,
                'eq-high-freq': 12000,
                'eq-high-q': 0.6,
            },
        },
        {
            type: 'gluten',
            name: 'Soft Glue',
            params: {
                topology: 1,
                amount: 25,
                threshold: -20,
                ratio: 1.5,
                attack: 60,
                release: 300,
                knee: 12,
                makeup: 0,
                mix: 1,
                autoMakeup: 1,
                autoRelease: 1,
            },
        },
        { type: 'proof', name: 'Proof Mastering', params: { input_gain: 0, output_gain: 0, lim_ceiling: -2 } },
        { type: 'builtin-lufs-meter', name: 'LUFS', params: { 'lufs-target': -18 } },
    ],
};

export function setMasterChain(masterTrack: Track, preset: MasterPreset): void {
    const chain = MASTER_CHAIN_PRESETS[preset];
    masterTrack.devices = chain.map(buildDevice);
}

type FinalizeTemplateInput = {
    tracks: Track[];
    selectTrackId?: string | null;
    vcaGroups?: VcaGroupHandle[];
    sidechainRoutes?: Array<{ trigger: Track; target: Track; deviceId: string; parameterId?: string }>;
};

export async function finalizeTemplate(input: FinalizeTemplateInput): Promise<void> {
    if (input.vcaGroups && input.vcaGroups.length > 0) {
        commitVcaGroups(input.vcaGroups, input.tracks);
    }

    trackStore.set({
        tracks: input.tracks,
        selectedTrackId: input.selectTrackId ?? null,
    });

    syncArrangement(input.tracks);

    ensureTrackStrips();

    const { waitForDevices } = await import('#/modules/AudioEngine/useCases');
    await waitForDevices();

    for (const route of input.sidechainRoutes ?? []) {
        addSidechainRoute(route.trigger.id, route.target.id, route.deviceId, route.parameterId ?? 'sc-comp-threshold');
    }
}
