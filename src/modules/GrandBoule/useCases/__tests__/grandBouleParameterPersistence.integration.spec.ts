import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type Track, trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, getPluginById } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';

import { createDefaultGrandBouleConfig } from '../../models/GrandBouleConfig';
import {
    createDisconnectedGrandBouleEngineHandle,
    type GrandBouleEngineHandle,
} from '../../repositories/grandBouleEngineHandle';
import { createGrandBouleStore, resetGrandBouleStores } from '../../stores/grandBouleStore';
import { GRAND_BOULE_PERSISTED_PARAM_IDS, type GrandBoulePersistedParamId } from '../grandBouleParamBridge/helpers';
import { hydrateGrandBouleConfigFromProject } from '../hydrateGrandBouleConfigFromProject';
import { setGrandBouleMasterGain } from '../setGrandBouleMasterGain';
import { setGrandBouleRadiationParam } from '../setGrandBouleRadiationParam';
import { setGrandBouleSoundboardSend } from '../setGrandBouleSoundboardSend';
import { setGrandBouleSympatheticSend } from '../setGrandBouleSympatheticSend';

/**
 * The load-bearing guards for Grand Boule knob persistence: move a Mix knob, reload
 * the project, and the knob is where you left it — and a drag is one undo entry.
 *
 * The observable is the value a *reload* produces.
 * `hydrateGrandBouleConfigFromProject` is what the panel runs on mount, so driving
 * it after `resetGrandBouleStores()` — the same call project teardown makes — is the
 * same read the user's reload performs.
 *
 * Everything below the three setters is real: the real Arrangement handler map, the
 * real `executeAppAction`, a real Automerge document, the real undo stack. Only
 * `updateDeviceParam` is stubbed, because it addresses a live AudioContext that does
 * not exist under Vitest.
 */

const engineWrites: { paramId: string; value: number }[] = [];

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: (_trackId: string, _deviceId: string, paramId: string, value: number) => {
        engineWrites.push({ paramId, value });
    },
    ensureTrackStrip: () => ({ deviceNodes: [], analyserNode: null }),
    getAudioSampleRate: () => 44100,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const DEVICE_ID = 'grand-boule-1';
const TRACK_ID = 'track-1';

/** Records what the transient half pushes straight at the engine handle. */
const handleWrites: { name: string; value: number }[] = [];

function recordingEngine(): GrandBouleEngineHandle {
    return {
        ...createDisconnectedGrandBouleEngineHandle(),
        setParam: ({ name, value }) => {
            handleWrites.push({ name, value });
        },
        isReady: () => true,
    };
}

/**
 * Three distinct value sets: the module default, what the fixture is *constructed*
 * with, and what the test *sets*. A guard that writes the default cannot tell
 * persistence from a fallback, and one that writes the fixture's own value cannot
 * tell a write that landed from one that never happened.
 */
const COMMITTED: Readonly<Record<GrandBoulePersistedParamId, number>> = {
    masterGain: 0.85,
    soundboardSend: 0.18,
    sympatheticSend: 0.83,
    lidPosition: 0.35,
    micPosition: 2,
};

const CONSTRUCTED: Readonly<Record<GrandBoulePersistedParamId, number>> = {
    masterGain: 0.32,
    soundboardSend: 0.91,
    sympatheticSend: 0.07,
    lidPosition: 0.82,
    micPosition: 0,
};

const SETTERS: Readonly<Record<GrandBoulePersistedParamId, (value: number, isTransient?: boolean) => void>> = {
    masterGain: (value, isTransient) =>
        setGrandBouleMasterGain({
            deviceId: DEVICE_ID,
            engine: recordingEngine(),
            store: createGrandBouleStore(DEVICE_ID),
            gain: value,
            isTransient,
        }),
    soundboardSend: (value, isTransient) =>
        setGrandBouleSoundboardSend({
            deviceId: DEVICE_ID,
            engine: recordingEngine(),
            store: createGrandBouleStore(DEVICE_ID),
            amount: value,
            isTransient,
        }),
    sympatheticSend: (value, isTransient) =>
        setGrandBouleSympatheticSend({
            deviceId: DEVICE_ID,
            engine: recordingEngine(),
            store: createGrandBouleStore(DEVICE_ID),
            amount: value,
            isTransient,
        }),
    lidPosition: (value, isTransient) =>
        setGrandBouleRadiationParam({
            deviceId: DEVICE_ID,
            engine: recordingEngine(),
            store: createGrandBouleStore(DEVICE_ID),
            paramId: 'lidPosition',
            value,
            isTransient,
        }),
    micPosition: (value, isTransient) =>
        setGrandBouleRadiationParam({
            deviceId: DEVICE_ID,
            engine: recordingEngine(),
            store: createGrandBouleStore(DEVICE_ID),
            paramId: 'micPosition',
            value,
            isTransient,
        }),
};

/**
 * Built here rather than imported from Arrangement's `TrackDummy`: a spec in another
 * module may only reach Arrangement through its contract barrels.
 */
function grandBouleTrack(parameterValues: Record<string, number>): Track {
    return {
        id: TRACK_ID,
        name: 'Piano',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#0000ff',
        clips: [],
        devices: [{ id: DEVICE_ID, name: 'Grand Boule', type: 'grand-boule', bypassed: false, parameterValues }],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

function stored(paramId: string): number | undefined {
    return trackStore.value?.tracks
        .find((track) => track.id === TRACK_ID)
        ?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues[paramId];
}

function sessionConfig(paramId: GrandBoulePersistedParamId): number | undefined {
    return createGrandBouleStore(DEVICE_ID).value?.config[paramId];
}

function undoDepth(): number {
    return undoStore.value?.past.length ?? 0;
}

/** Wipe the session stores the way project teardown does, then re-seed from truth. */
function simulateReload(): void {
    resetGrandBouleStores();
    hydrateGrandBouleConfigFromProject(DEVICE_ID);
}

describe('Grand Boule knob values survive a reload', () => {
    beforeEach(() => {
        engineWrites.length = 0;
        handleWrites.length = 0;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('grand boule parameter persistence');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });

        trackStore.set({
            tracks: [grandBouleTrack({ ...CONSTRUCTED })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        resetGrandBouleStores();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        resetGrandBouleStores();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('persists and restores every parameter the registry declares', async () => {
        // The population is read from the descriptor, not from a list maintained
        // here: a parameter added to `GRAND_BOULE_DESCRIPTOR` and forgotten
        // everywhere else fails this test rather than shipping unpersisted.
        const declared = getPluginById('grand-boule')?.parameters ?? [];
        expect(declared.length).toBeGreaterThan(0);

        for (const parameter of declared) {
            const paramId = parameter.id as GrandBoulePersistedParamId;
            expect(GRAND_BOULE_PERSISTED_PARAM_IDS).toContain(paramId);

            const value = COMMITTED[paramId];
            expect(value).toBeGreaterThanOrEqual(parameter.minValue);
            expect(value).toBeLessThanOrEqual(parameter.maxValue);

            SETTERS[paramId](value);
            await vi.waitFor(() => {
                expect(stored(paramId)).toBe(value);
            });
        }

        simulateReload();

        const defaults = createDefaultGrandBouleConfig();
        for (const parameter of declared) {
            const paramId = parameter.id as GrandBoulePersistedParamId;
            expect(sessionConfig(paramId)).toBe(COMMITTED[paramId]);
            // Not the default, and not what the fixture was built with.
            expect(sessionConfig(paramId)).not.toBe(defaults[paramId]);
            expect(sessionConfig(paramId)).not.toBe(CONSTRUCTED[paramId]);
        }
    });

    it('leaves a parameter project truth holds nothing for on its module default', () => {
        trackStore.set({
            tracks: [grandBouleTrack({ masterGain: 0.9 })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });

        simulateReload();

        const defaults = createDefaultGrandBouleConfig();
        expect(sessionConfig('masterGain')).toBe(0.9);
        expect(sessionConfig('soundboardSend')).toBe(defaults.soundboardSend);
        expect(sessionConfig('sympatheticSend')).toBe(defaults.sympatheticSend);
        expect(sessionConfig('lidPosition')).toBe(defaults.lidPosition);
        expect(sessionConfig('micPosition')).toBe(defaults.micPosition);
    });

    it('normalizes finite corrupt persisted radiation values before they reach the session controls', () => {
        trackStore.set({
            tracks: [grandBouleTrack({ lidPosition: -1e308, micPosition: 1.5 })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });

        simulateReload();

        expect(sessionConfig('lidPosition')).toBe(0);
        expect(sessionConfig('micPosition')).toBe(2);
    });

    it('restores the default control value when project truth has no stored value', () => {
        trackStore.set({
            tracks: [grandBouleTrack({})],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        resetGrandBouleStores();

        SETTERS.lidPosition(0.25, true);
        expect(sessionConfig('lidPosition')).toBe(0.25);

        hydrateGrandBouleConfigFromProject(DEVICE_ID);

        expect(sessionConfig('lidPosition')).toBe(createDefaultGrandBouleConfig().lidPosition);
    });

    it('undoes and redoes the first legacy-project radiation edit exactly', async () => {
        const legacyValues: Record<string, number> = { ...CONSTRUCTED };
        delete legacyValues.lidPosition;
        trackStore.set({
            tracks: [grandBouleTrack(legacyValues)],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        resetGrandBouleStores();

        SETTERS.lidPosition(0.35);
        await vi.waitFor(() => {
            expect(stored('lidPosition')).toBe(0.35);
        });
        expect(undoDepth()).toBe(1);

        await undo();
        const afterUndo = trackStore.value?.tracks[0]?.devices[0]?.parameterValues ?? {};
        expect(Object.hasOwn(afterUndo, 'lidPosition')).toBe(false);
        hydrateGrandBouleConfigFromProject(DEVICE_ID);
        expect(sessionConfig('lidPosition')).toBe(createDefaultGrandBouleConfig().lidPosition);

        await redo();
        expect(stored('lidPosition')).toBe(0.35);
    });

    it('reconciles transient UI and audio when the device disappears before commit', async () => {
        resetGrandBouleStores();
        hydrateGrandBouleConfigFromProject(DEVICE_ID);

        SETTERS.lidPosition(0.25, true);
        expect(sessionConfig('lidPosition')).toBe(0.25);
        trackStore.set({
            tracks: [{ ...grandBouleTrack({ ...CONSTRUCTED }), devices: [] }],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        SETTERS.lidPosition(0.25);

        await vi.waitFor(() => {
            expect(sessionConfig('lidPosition')).toBe(createDefaultGrandBouleConfig().lidPosition);
        });
        expect(stored('lidPosition')).toBeUndefined();
        expect(handleWrites).toEqual([
            { name: 'lidPosition', value: 0.25 },
            { name: 'lidPosition', value: createDefaultGrandBouleConfig().lidPosition },
        ]);
        expect(undoDepth()).toBe(0);
    });

    it('spends exactly one undo entry on a drag, whatever it passes through on the way', async () => {
        const before = undoDepth();

        // Interior points, not just the endpoints: a guard that only drives the
        // last value cannot tell a coalesced gesture from a reshaped one.
        const sweep = [0.4, 0.55, 0.72, 0.81, 0.9, 0.96];
        for (const intermediate of sweep) {
            SETTERS.masterGain(intermediate, true);
        }

        // Every interior value reached the engine, so the piano moved under the
        // user's thumb...
        expect(handleWrites.map((write) => write.value)).toEqual(sweep);
        expect(handleWrites.every((write) => write.name === 'masterGain')).toBe(true);
        // ...and none of them reached project truth or the undo stack.
        expect(stored('masterGain')).toBe(CONSTRUCTED.masterGain);
        expect(undoDepth()).toBe(before);

        SETTERS.masterGain(0.85);
        await vi.waitFor(() => {
            expect(stored('masterGain')).toBe(0.85);
        });

        expect(undoDepth()).toBe(before + 1);

        await undo();

        expect(stored('masterGain')).toBe(CONSTRUCTED.masterGain);
        expect(undoDepth()).toBe(before);
    });

    it('moves the session store on every transient step so the knob tracks the pointer', () => {
        const sweep = [0.2, 0.5, 0.9];
        const seen: (number | undefined)[] = [];
        for (const intermediate of sweep) {
            SETTERS.soundboardSend(intermediate, true);
            seen.push(sessionConfig('soundboardSend'));
        }

        expect(seen).toEqual(sweep);
        expect(stored('soundboardSend')).toBe(CONSTRUCTED.soundboardSend);
    });

    it('does not push the commit at the engine handle twice', async () => {
        SETTERS.sympatheticSend(0.83);
        await vi.waitFor(() => {
            expect(stored('sympatheticSend')).toBe(0.83);
        });

        // The commit reaches audio through `setDeviceParameter` -> `updateDeviceParam`,
        // not through the handle; a second direct push would be a redundant message
        // per gesture and a second place that could disagree about the clamped value.
        expect(handleWrites).toEqual([]);
        expect(engineWrites).toEqual([{ paramId: 'sympatheticSend', value: 0.83 }]);
    });

    it('gives two parameters two entries, so undo unwinds them one at a time', async () => {
        SETTERS.soundboardSend(0.18);
        await vi.waitFor(() => {
            expect(stored('soundboardSend')).toBe(0.18);
        });
        SETTERS.sympatheticSend(0.83);
        await vi.waitFor(() => {
            expect(stored('sympatheticSend')).toBe(0.83);
        });

        await undo();

        expect(stored('sympatheticSend')).toBe(CONSTRUCTED.sympatheticSend);
        expect(stored('soundboardSend')).toBe(0.18);

        await undo();

        expect(stored('soundboardSend')).toBe(CONSTRUCTED.soundboardSend);
    });

    it('clamps the committed value to the declared range before it reaches history', async () => {
        // `soundboardSend` is declared 0..1. The setter clamps on the way in and
        // `setDeviceParameter` holds the range behind the action.
        SETTERS.soundboardSend(9);
        await vi.waitFor(() => {
            expect(stored('soundboardSend')).toBe(1);
        });

        await undo();

        expect(stored('soundboardSend')).toBe(CONSTRUCTED.soundboardSend);
    });
});
