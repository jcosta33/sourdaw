import { describe, expect, it, vi } from 'vitest';

// The Faust registry is runtime state; the spec names which ids it registered
// as instruments. Every route asks it through this one barrel.
const FAUST_INSTRUMENT_TYPES = new Set(['faust-epiano']);

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    isFaustInstrumentModule: (moduleId: string) => FAUST_INSTRUMENT_TYPES.has(moduleId),
}));

import { resolveLiveInputNoteReceiver } from '#/modules/MIDI/useCases';
import { resolvePlaybackNoteReceiver } from '#/modules/Transport/useCases';

import { type DeviceNodeEntry } from '../buildDeviceChain';
import { selectOfflineNoteReceiver } from '../offlineRender/selectOfflineNoteReceiver';
import { resolveAuditionNoteReceiver } from '../resolveAuditionNoteReceiver';

type ChainDevice = { id: string; type: string };

// Device types the offline chain builds no node for: the kit schedulers and the
// built-in synth voice them (`isNodelessOfflineDeviceType`).
const NODELESS_TYPES = new Set(['builtin-drum-machine-808', 'builtin-drum-kit', 'builtin-synth']);
// Chain devices whose strategy declares `acceptsNotes`, so the chain entry
// carries a note surface — every node-backed instrument, never an effect.
const NOTE_SURFACE_TYPES = new Set(['levain', 'fermenter', 'grand-boule', 'builtin-crumbs', 'toaster', 'faust-epiano']);

function buildChainEntry(device: ChainDevice): DeviceNodeEntry {
    const entry: DeviceNodeEntry = {
        deviceId: device.id,
        deviceType: device.type,
        contributesAudio: true,
        node: {} as DeviceNodeEntry['node'],
        strategy: {} as DeviceNodeEntry['strategy'],
    };
    if (NOTE_SURFACE_TYPES.has(device.type)) {
        entry.instrumentControls = { noteOn: () => {}, noteOff: () => {} };
    }
    return entry;
}

/** The chain `buildDeviceChain` builds for these devices, in chain order. */
function buildOfflineChain(devices: readonly ChainDevice[]): DeviceNodeEntry[] {
    return devices.filter((device) => !NODELESS_TYPES.has(device.type)).map(buildChainEntry);
}

/** The device each route would hand a note to, or null for the default synth voice. */
function routeSelections(devices: readonly ChainDevice[]): Record<string, string | null> {
    const offline = selectOfflineNoteReceiver(devices, buildOfflineChain(devices));
    // Offline voices a node-backed receiver through its chain entry and a kit or
    // the built-in synth without one, so what it dispatches to is the entry when
    // there is one and the receiver otherwise.
    const offlineDispatch = offline.instrumentEntry?.deviceId ?? offline.receiver?.device.id ?? null;
    return {
        playback: resolvePlaybackNoteReceiver(devices)?.device.id ?? null,
        offline: offlineDispatch,
        liveInput: resolveLiveInputNoteReceiver(devices, false)?.device.id ?? null,
        audition: resolveAuditionNoteReceiver(devices, false)?.device.id ?? null,
    };
}

function allRoutes(deviceId: string | null): Record<string, string | null> {
    return { playback: deviceId, offline: deviceId, liveInput: deviceId, audition: deviceId };
}

const levain = { id: 'levain-1', type: 'levain' };
const drum808 = { id: 'drum-1', type: 'builtin-drum-machine-808' };
const drumKit = { id: 'kit-1', type: 'builtin-drum-kit' };
const faust = { id: 'faust-1', type: 'faust-epiano' };
const toaster = { id: 'toaster-1', type: 'toaster' };
const fermenter = { id: 'fermenter-1', type: 'fermenter' };
const grandBoule = { id: 'grand-boule-1', type: 'grand-boule' };
const crumbs = { id: 'crumbs-1', type: 'builtin-crumbs' };
const defaultSynth = { id: 'synth-1', type: 'builtin-synth' };
const gluten = { id: 'gluten-1', type: 'gluten' };
const faustReverb = { id: 'faust-reverb-1', type: 'faust-reverb' };

describe('every route sends a mixed-instrument track to its first instrument', () => {
    it.each([
        { name: 'levain then 808', devices: [levain, drum808], receiver: levain },
        { name: '808 then levain', devices: [drum808, levain], receiver: drum808 },
        { name: 'faust then drum kit', devices: [faust, drumKit], receiver: faust },
        { name: 'drum kit then faust', devices: [drumKit, faust], receiver: drumKit },
        { name: 'toaster then levain', devices: [toaster, levain], receiver: toaster },
        { name: 'levain then toaster', devices: [levain, toaster], receiver: levain },
        { name: 'grand boule then fermenter', devices: [grandBoule, fermenter], receiver: grandBoule },
        { name: 'effect then levain then 808', devices: [gluten, levain, drum808], receiver: levain },
        { name: 'faust effect then 808 then levain', devices: [faustReverb, drum808, levain], receiver: drum808 },
    ])('$name', ({ devices, receiver }) => {
        const firstInstrument = devices.find((device) => device !== gluten && device !== faustReverb);
        expect(receiver).toBe(firstInstrument);
        expect(routeSelections(devices)).toEqual(allRoutes(receiver.id));
    });
});

describe('a single-instrument track keeps its instrument on every route', () => {
    it.each([
        { name: 'levain', devices: [levain], receiver: levain },
        { name: '808', devices: [drum808], receiver: drum808 },
        { name: 'drum kit', devices: [drumKit], receiver: drumKit },
        { name: 'faust instrument', devices: [faust], receiver: faust },
        { name: 'toaster', devices: [toaster], receiver: toaster },
        { name: 'fermenter', devices: [fermenter], receiver: fermenter },
        { name: 'grand boule', devices: [grandBoule], receiver: grandBoule },
        { name: 'crumbs', devices: [crumbs], receiver: crumbs },
        { name: 'built-in synth', devices: [defaultSynth], receiver: defaultSynth },
        { name: 'instrument behind an effect', devices: [gluten, levain], receiver: levain },
    ])('$name', ({ devices, receiver }) => {
        expect(routeSelections(devices)).toEqual(allRoutes(receiver.id));
    });

    it('sends a track the default synth started with to the instrument added after it', () => {
        expect(routeSelections([defaultSynth, levain, drum808])).toEqual(allRoutes(levain.id));
    });

    it('leaves a track with no instrument on the default synth voice', () => {
        expect(routeSelections([gluten])).toEqual(allRoutes(null));
        expect(routeSelections([])).toEqual(allRoutes(null));
    });
});
