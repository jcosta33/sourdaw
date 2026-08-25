import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { type Track, trackStore } from '#/modules/Arrangement/stores';

import { createDefaultGrandBouleConfig } from '../../../models/GrandBouleConfig';
import { createGrandBouleStore, resetGrandBouleStores } from '../../../stores/grandBouleStore';
import { setGrandBouleEventBus, type GrandBouleEventBus } from '../../../useCases/grandBouleEventBus';
import { GrandBoulePanel } from '../GrandBoulePanel';

// Render with the typed default so the panel mounts and its effects run without
// depending on the global useStore blob. The assertion reads the *real*
// per-device store, which the hydration writes directly.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
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

function pianoTrack(parameterValues: Record<string, number>): Track {
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
            tracks: [pianoTrack({ masterGain: SAVED_MASTER_GAIN })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        resetGrandBouleStores();
    });

    afterEach(() => {
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
