import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { TrackLevelSection } from '../TrackLevelSection';

import type { Track as ArrangementTrack } from '#/modules/Arrangement/stores';
import type { Track } from '../../../../models/TrackViewTypes';

vi.mock('#/modules/ControlSurface/presentations/views', () => ({
    MidiLearnButton: () => <button type="button">Learn</button>,
}));

const PAD_PARENT_ID = 'track-toaster';
const PAD_CHILD_ID = 'track-pad-kick';
const PLAIN_ID = 'track-plain';

const viewTrack = (id: string, gain: number): Track => ({
    id,
    name: 'Test Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain,
    pan: 0,
    color: '#ff0000',
    clips: [],
    devices: [],
    midiFx: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 100,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
});

const storeTrack = (id: string, overrides: Partial<ArrangementTrack> = {}): ArrangementTrack => ({
    ...(viewTrack(id, 0.75) as unknown as ArrangementTrack),
    ...overrides,
});

/**
 * The control's own travel, read off the rendered element rather than off the
 * prop the component passed down.
 *
 * A mocked `Slider` that echoed `max` back as an attribute would pass whatever
 * the component handed it, including a value the real control would reject —
 * so these render the shipped Radix slider and assert `aria-valuemax`, which is
 * the bound a user's drag actually stops at.
 */
describe('TrackLevelSection — gain travel', () => {
    beforeEach(() => {
        trackStore.set({
            selectedTrackId: null,
            tracks: [
                storeTrack(PAD_PARENT_ID, {
                    devices: [
                        {
                            id: 'device-toaster',
                            type: 'toaster',
                            name: 'Toaster',
                            bypassed: false,
                            parameterValues: {},
                        },
                    ],
                }),
                storeTrack(PAD_CHILD_ID, { parentId: PAD_PARENT_ID }),
                storeTrack(PLAIN_ID),
            ],
        });
    });

    it('lets the gain slider reach the fader ceiling, in the percent-of-unity its readout uses', () => {
        // A track pushed into the fader's `+6 dB` from the mixer reads about
        // 200% here. A control that stopped at 100 could not represent that
        // value, and the first touch would have written the make-up gain away.
        render(<TrackLevelSection track={viewTrack(PLAIN_ID, 1.5)} />);

        expect(screen.getByRole('slider', { name: 'Test Track gain' })).toHaveAttribute(
            'aria-valuemax',
            String(FADER_MAX_GAIN * 100)
        );
    });

    it('gives a Toaster pad child the same fader travel as any other track', () => {
        // The fader no longer mirrors onto the pad's `volume` (#2458) — the pad
        // keeps its own level — so nothing holds this track at unity. Read back
        // from the fader law rather than written out, so this fails if the
        // control and the writer ever diverge again.
        render(<TrackLevelSection track={viewTrack(PAD_CHILD_ID, 0.75)} />);

        expect(screen.getByRole('slider', { name: 'Test Track gain' })).toHaveAttribute(
            'aria-valuemax',
            String(FADER_MAX_GAIN * 100)
        );
    });
});
