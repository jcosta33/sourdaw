import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { type Track, trackStore } from '#/modules/Arrangement/stores';

import { createDefaultGrandBouleConfig } from '../../../models/GrandBouleConfig';
import { createDefaultGrandBoulePersistedState, toGrandBouleDeviceState } from '../../../models/GrandBouleDeviceState';
import { type GrandBoulePresetParameters } from '../../../models/GrandBoulePreset';
import { createGrandBouleStore, resetGrandBouleStores } from '../../../stores/grandBouleStore';
import { setGrandBouleEventBus, type GrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { reconcileGrandBouleDevicesFromProject } from '../../../useCases/reconcileGrandBouleDevicesFromProject';
import { GrandBoulePanel } from '../GrandBoulePanel';

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    ensureTrackStrip: () => ({ deviceNodes: [], analyserNode: null }),
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Command/useCases')>()),
    executeAppAction: vi.fn(async () => undefined),
}));

/**
 * Guard for a claim the manual makes about undo.
 *
 * `docs/manual/02-concepts.md` tells the reader that undo restores project truth
 * and the sound but not the panel, and that whether reopening the device clears
 * that disagreement depends on the device: the reverb and the piano re-read the
 * project when their panel opens, while Gluten and Grinder never do. That
 * sentence is only safe to print while this panel actually performs the read.
 *
 * `grandBouleParameterPersistence.integration.spec.ts` drives
 * `hydrateGrandBouleConfigFromProject` directly and states in its own docblock
 * that it is "what the panel runs on mount" — an assumption nothing checked.
 * Deleting the `useEffect` at `GrandBoulePanel.tsx:180-182` left that spec, and
 * every other spec in the module, green. This closes the gap at the panel: mount
 * the real component and assert the session store now holds project truth.
 *
 * Asserting the store rather than the effect means a rename or a move of the
 * hydration keeps this green, and only losing the read itself turns it red.
 */

const TRACK_ID = 'track-hydration';
const DEVICE_ID = 'device-hydration';

/** Deliberately unlike `createDefaultGrandBouleConfig().masterGain` (0.1). */
const SAVED_MASTER_GAIN = 0.42;

function pianoTrack(parameterValues: Record<string, number>, deviceId = DEVICE_ID, trackId = TRACK_ID): Track {
    return {
        id: trackId,
        name: 'Piano',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#0000ff',
        clips: [],
        devices: [{ id: deviceId, name: 'Grand Boule', type: 'grand-boule', bypassed: false, parameterValues }],
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

function sessionMasterGain(): number | undefined {
    return createGrandBouleStore(DEVICE_ID).value?.config.masterGain;
}

/**
 * The panel also subscribes to MIDI on mount, which needs a bus in the container.
 * Nothing here emits, so a bus that records no handlers is enough to let the
 * component mount and its hydration effect run.
 */
const silentEventBus: GrandBouleEventBus = {
    emit(): Promise<void> {
        return Promise.resolve();
    },
    on(): () => void {
        return () => undefined;
    },
};

describe('GrandBoulePanel reads project truth when it opens', () => {
    beforeEach(() => {
        Container.clear();
        setGrandBouleEventBus(silentEventBus);
        trackStore.set({
            tracks: [
                pianoTrack({ masterGain: SAVED_MASTER_GAIN, micPosition: 2 }),
                pianoTrack({ micPosition: 0 }, SECOND_DEVICE_ID, 'track-preset-2'),
            ],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        resetGrandBouleStores();
    });

    afterEach(() => {
        cleanup();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        resetGrandBouleStores();
    });

    it('seeds the session config from the saved parameter value on mount', () => {
        const defaults = createDefaultGrandBouleConfig();
        // The store starts at the module default, so the assertion below cannot
        // pass by the saved value having been there all along.
        expect(sessionMasterGain()).toBe(defaults.masterGain);
        expect(SAVED_MASTER_GAIN).not.toBe(defaults.masterGain);

        render(<GrandBoulePanel deviceId={DEVICE_ID} />);

        expect(sessionMasterGain()).toBe(SAVED_MASTER_GAIN);
    });

    it('repaints the mounted shelf as project replay restores Warm then Bright', () => {
        render(<GrandBoulePanel deviceId={DEVICE_ID} />);

        fireEvent.click(presetButton('Warm Crumb'));
        expect(presetButton('Warm Crumb')).toHaveClass('bg-neutral-300/10');
        fireEvent.click(presetButton('Bright Crust'));
        expect(presetButton('Bright Crust')).toHaveClass('bg-neutral-300/10');

        act(() => replayProjectVoicing(WARM));
        expect(createGrandBouleStore(DEVICE_ID).value?.parameters).toEqual(WARM);
        expect(readPresetShelf()).toEqual(expectedPresetShelf('Warm Crumb'));

        act(() => replayProjectVoicing(BRIGHT));
        expect(readPresetShelf()).toEqual(expectedPresetShelf('Bright Crust'));
        expect(createGrandBouleStore(DEVICE_ID).value?.config.micPosition).toBe(2);
        expect(createGrandBouleStore(SECOND_DEVICE_ID).value?.parameters).toEqual(
            createDefaultGrandBoulePersistedState().parameters
        );
    });

    it('indicates cold-hydrated voicings and clears a near match on the first device', () => {
        act(() => replayProjectVoicing(WARM));
        const view = render(<GrandBoulePanel deviceId={DEVICE_ID} />);
        expect(readPresetShelf()).toEqual(expectedPresetShelf('Warm Crumb'));

        act(() => replayProjectVoicing({ ...WARM, toneTilt: WARM.toneTilt + 0.0001 }));
        expect(readPresetShelf()).toEqual(expectedPresetShelf(null));

        view.rerender(<GrandBoulePanel deviceId={SECOND_DEVICE_ID} />);
        expect(readPresetShelf()).toEqual(expectedPresetShelf('Classic Miche'));
        expect(createGrandBouleStore(SECOND_DEVICE_ID).value?.config.micPosition).toBe(0);
    });

    it('indicates Classic at the neutral defaults', () => {
        render(<GrandBoulePanel deviceId={DEVICE_ID} />);
        expect(readPresetShelf()).toEqual(expectedPresetShelf('Classic Miche'));
    });

    it('re-reads for the new device when the panel is re-keyed', () => {
        const secondDeviceId = 'device-hydration-2';
        const secondGain = 0.19;
        trackStore.set({
            tracks: [
                pianoTrack({ masterGain: SAVED_MASTER_GAIN }),
                {
                    ...pianoTrack({ masterGain: secondGain }),
                    id: 'track-hydration-2',
                    devices: [
                        {
                            id: secondDeviceId,
                            name: 'Grand Boule',
                            type: 'grand-boule',
                            bypassed: false,
                            parameterValues: { masterGain: secondGain },
                        },
                    ],
                },
            ],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });

        const view = render(<GrandBoulePanel deviceId={DEVICE_ID} />);
        expect(sessionMasterGain()).toBe(SAVED_MASTER_GAIN);

        view.rerender(<GrandBoulePanel deviceId={secondDeviceId} />);

        expect(createGrandBouleStore(secondDeviceId).value?.config.masterGain).toBe(secondGain);
    });
});

const WARM = { hammerHardness: -0.35, velocityCurve: 1.2, stereoWidth: 0.45, toneTilt: -0.3 };
const BRIGHT = { hammerHardness: 0.4, velocityCurve: 0.85, stereoWidth: 0.7, toneTilt: 0.35 };
const SECOND_DEVICE_ID = 'device-preset-2';

function replayProjectVoicing(parameters: GrandBoulePresetParameters): void {
    // Substitute the projection replay would publish, then run its real session reconciliation.
    const deviceState = toGrandBouleDeviceState({ ...createDefaultGrandBoulePersistedState(), parameters });
    trackStore.update((current) => {
        if (current === null) {
            throw new Error('Replay requires a projected track fixture.');
        }
        return {
            ...current,
            tracks: current.tracks.map((track) => {
                if (track.id !== TRACK_ID) {
                    return track;
                }
                return {
                    ...track,
                    devices: track.devices.map((device) =>
                        device.id === DEVICE_ID ? { ...device, deviceState } : device
                    ),
                };
            }),
        };
    });
    reconcileGrandBouleDevicesFromProject();
}

const PRESET_NAMES = ['Warm Crumb', 'Bright Crust', 'Classic Miche'] as const;
type PresetName = (typeof PRESET_NAMES)[number];

function presetButton(preset: PresetName): HTMLElement {
    return screen.getByRole('button', { name: (name) => name.startsWith(preset) });
}

function readPresetShelf() {
    return PRESET_NAMES.map((name) => {
        const button = presetButton(name);
        return {
            name,
            highlighted: button.classList.contains('bg-neutral-300/10'),
            pressed: button.getAttribute('aria-pressed'),
        };
    });
}

function expectedPresetShelf(active: PresetName | null) {
    return PRESET_NAMES.map((name) => ({
        name,
        highlighted: name === active,
        pressed: name === active ? 'true' : 'false',
    }));
}
