/**
 * Which device on a MIDI strip the engine takes notes on (#3892, #4204).
 *
 * The law is pure, so nothing is mocked. Every case drives one admission rule,
 * because the two failures are opposite and both silent: a strip with no sink
 * is a part nothing plays, and a sink naming an instance the engine does not
 * hold is a `schedule-midi` aimed at no note store.
 */

import { describe, expect, it } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';

import { GENERATIVE_MIDI_EXCLUSION_REASON, nativeMidiNoteSink } from '../nativeMidiNoteSink';

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return { name: overrides.id, type: 'knead', bypassed: false, parameterValues: {}, ...overrides };
}

function midiTrack(devices: readonly Device[]): Track {
    return { id: 'midi-1', name: 'Lead', kind: 'midi', devices } as unknown as Track;
}

function sinkOf(devices: readonly Device[], attachedInstanceIds: readonly string[] = []) {
    return nativeMidiNoteSink({
        track: midiTrack(devices),
        attachedInstanceIds: new Set(attachedInstanceIds),
        bakedStripIds: new Set(),
    });
}

describe('nativeMidiNoteSink', () => {
    it('takes a built-in instrument as the sink by its type alone', () => {
        const instrument = createDevice({ id: 'd-fermenter', type: 'fermenter' });

        expect(sinkOf([instrument])).toEqual({ outcome: 'voiced', device: instrument });
    });

    it('answers none for a chain of built-in effects, which generate nothing', () => {
        expect(sinkOf([createDevice({ id: 'd-knead', type: 'knead' })])).toEqual({ outcome: 'none' });
    });

    it('takes an attached hosted plugin as the sink', () => {
        const plugin = createDevice({
            id: 'd-plugin',
            type: 'external-plugin',
            externalPluginId: 'clap:com.example.synth',
            externalInstanceId: 'i1',
        });

        expect(sinkOf([plugin], ['i1'])).toEqual({ outcome: 'voiced', device: plugin });
    });

    it('answers none for a hosted plugin the engine does not hold', () => {
        const plugin = createDevice({
            id: 'd-plugin',
            type: 'external-plugin',
            externalPluginId: 'clap:com.example.synth',
            externalInstanceId: 'i1',
        });

        expect(sinkOf([plugin], [])).toEqual({ outcome: 'none' });
    });

    // Crumbs' note store exists because the engine spliced the instance in, not
    // because the strip was built — so its admission is the attach state under
    // the device's own id, exactly as a hosted plugin's is under the instance
    // id. `nativeBuiltinBodies` has no Crumbs row on purpose, so a sink rule
    // reading only `soundsNativeNotes` leaves every Crumbs strip unvoiced.
    it('takes an attached Crumbs device as the sink, keyed by the device id', () => {
        const crumbs = createDevice({ id: 'd-crumbs', type: 'builtin-crumbs' });

        expect(sinkOf([crumbs], ['d-crumbs'])).toEqual({ outcome: 'voiced', device: crumbs });
    });

    it('answers none for a Crumbs device the engine does not hold', () => {
        expect(sinkOf([createDevice({ id: 'd-crumbs', type: 'builtin-crumbs' })], [])).toEqual({ outcome: 'none' });
    });

    it('does not admit a Crumbs device on some other instance being attached', () => {
        expect(sinkOf([createDevice({ id: 'd-crumbs', type: 'builtin-crumbs' })], ['i1'])).toEqual({
            outcome: 'none',
        });
    });

    // A MIDI strip's instrument sits at the head of its chain, and a later
    // device is an effect however note-taking its type.
    it('takes the first sink in chain order, not a later one', () => {
        const crumbs = createDevice({ id: 'd-crumbs', type: 'builtin-crumbs' });
        const fermenter = createDevice({ id: 'd-fermenter', type: 'fermenter' });

        expect(sinkOf([crumbs, fermenter], ['d-crumbs'])).toEqual({ outcome: 'voiced', device: crumbs });
    });

    it('names the generative exclusion rather than voicing a yeast strip', () => {
        const crumbs = createDevice({ id: 'd-crumbs', type: 'builtin-crumbs' });
        const yeast = createDevice({ id: 'd-yeast', type: 'yeast' });

        expect(sinkOf([crumbs, yeast], ['d-crumbs'])).toEqual({
            outcome: 'excluded',
            reason: GENERATIVE_MIDI_EXCLUSION_REASON,
        });
    });

    it('answers none for a frozen strip, whose bake already contains the instrument', () => {
        const crumbs = createDevice({ id: 'd-crumbs', type: 'builtin-crumbs' });

        expect(
            nativeMidiNoteSink({
                track: midiTrack([crumbs]),
                attachedInstanceIds: new Set(['d-crumbs']),
                bakedStripIds: new Set(['midi-1']),
            })
        ).toEqual({ outcome: 'none' });
    });

    it('answers none for an audio strip, which is not in question here', () => {
        const crumbs = createDevice({ id: 'd-crumbs', type: 'builtin-crumbs' });

        expect(
            nativeMidiNoteSink({
                track: { id: 'audio-1', name: 'Drums', kind: 'audio', devices: [crumbs] } as unknown as Track,
                attachedInstanceIds: new Set(['d-crumbs']),
                bakedStripIds: new Set(),
            })
        ).toEqual({ outcome: 'none' });
    });
});
