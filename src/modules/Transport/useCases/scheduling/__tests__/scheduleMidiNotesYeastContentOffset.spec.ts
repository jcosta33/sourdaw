import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type Clip, trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import { ensureTrackStrip } from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { projectClipMidiEvents, projectCommittedGroove } from '#/modules/MIDI/useCases';
import { scheduleNote } from '#/modules/Synth/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import { defaultTransportState } from '../../../models/TransportState';
import { tempoMapStore } from '../../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../../stores/timeSignatureMapStore';
import { scheduleMidiNotes } from '../scheduleMidiNotes';

/** Types withheld only inside tests that exercise the generic admission guard. */
const injectedWithheldDeviceTypes = vi.hoisted(() => new Set<string>());

vi.mock('#/infra/release/deviceReleaseAdmission', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/infra/release/deviceReleaseAdmission')>();
    return {
        ...actual,
        isDeviceReleaseAdmitted: (deviceType: string) =>
            !injectedWithheldDeviceTypes.has(deviceType) && actual.isDeviceReleaseAdmitted(deviceType),
    };
});

const shouldPlayProbability = vi.hoisted(() => vi.fn((_input: { eventId: string }) => true));
const registerScheduledSourceMock = vi.hoisted(() => vi.fn<(node: AudioScheduledSourceNode) => void>());

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { value: { tracks: [] } },
}));
vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: { value: null },
}));
vi.mock('#/modules/Automation/stores', () => ({
    automationStore: { value: null },
}));
vi.mock('#/modules/Automation/useCases', () => ({
    getAutomationValueAtBeat: vi.fn(() => null),
    isRecordingAutomation: vi.fn(() => false),
}));
vi.mock('#/modules/Toaster/stores', () => ({ toasterStore: { value: null } }));
vi.mock('../../../stores/tempoMapStore', () => ({
    tempoMapStore: { value: { changes: [] } },
}));
vi.mock('../../../stores/timeSignatureMapStore', () => ({
    timeSignatureMapStore: { value: { changes: [] } },
}));
vi.mock('#/modules/Arrangement/useCases', () => ({
    resolveClipsWithComping: vi.fn((_trackId: string, clips: Clip[]) =>
        clips.map((clip) => ({
            ...clip,
            regionStartBeat: clip.startBeat,
            regionEndBeat: clip.endBeat,
            sourceStartBeat: clip.startBeat,
        }))
    ),
    getSynthParamsForTrack: vi.fn(() => ({})),
}));
vi.mock('#/modules/AudioEngine/useCases', () => ({
    applyNoteExpression: vi.fn(),
    registerScheduledSource: registerScheduledSourceMock,
    // The one definition of the MPE member default, as the production barrel
    // exports it (audit MD-8).
    getDefaultBendRangeSemitones: () => 48,
    getCompensationDelay: vi.fn(() => 0),
    ensureTrackStrip: vi.fn(() => ({ gainNode: {}, preFaderTap: { connect: vi.fn() } })),
    getCurrentTime: vi.fn(() => 0),
    getDrumKitByIndex: vi.fn(() => null),
    getAudioContext: vi.fn(() => ({
        sampleRate: 48000,
        createGain: vi.fn(() => ({ connect: vi.fn() })),
    })),
    scheduleFaustNote: vi.fn(),
}));
vi.mock('#/modules/Synth/useCases', () => ({
    getDrumKitDefByIndex: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
    scheduleKitNote: vi.fn(),
    scheduleNote: vi.fn(),
}));
vi.mock('#/modules/Yeast/useCases', () => ({
    processYeastMidi: vi.fn(),
    getYeastSchedulingLookahead: vi.fn(() => ({ earlyBeats: 0, lateBeats: 0 })),
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    getChordAtBeat: vi.fn(),
    projectClipMidiEvents: vi.fn(),
    projectCommittedGroove: vi.fn(({ events }: { events: readonly unknown[] }) => events),
    resolveMidiNoteArticulationId: ({ deviceType, articulation }: { deviceType: string; articulation?: string }) =>
        deviceType === 'levain' && articulation === 'staccato' ? 8 : null,
    transposeForChordTrack: vi.fn((param: unknown) => param),
    shouldPlayMidiEvent: shouldPlayProbability,
}));
vi.mock('../scheduleFrozenTrack', () => ({
    scheduleFrozenTrack: vi.fn(() => true),
}));

function projectedStartBeat(
    input: { eventsAreAbsolute?: boolean; iterationStartBeat: number; midiOffsetBeats: number },
    startBeat: number
): number {
    if (input.eventsAreAbsolute) {
        return startBeat;
    }
    return input.iterationStartBeat + startBeat - input.midiOffsetBeats;
}

function midiTrack(overrides: Record<string, unknown> = {}) {
    return {
        id: 'track-1',
        kind: 'midi',
        muted: false,
        parentId: null,
        followChordTrack: false,
        devices: [],
        clips: [],
        freezeState: { status: 'unfrozen' },
        ...overrides,
    } as never;
}

function midiClip(overrides: Record<string, unknown> = {}): Clip {
    return {
        id: 'clip-1',
        type: 'midi',
        muted: false,
        startBeat: 0,
        endBeat: 4,
        gain: 1,
        loopEnabled: false,
        ...overrides,
    } as Clip;
}

// Audit #4591 — on a track with a Yeast rack, the live scheduler selects and
// owns note-ons on the note's un-offset beat, then shifts the output back by
// the clip's `midiOffsetBeats` and drops it for falling outside the window.
// A clip with a content offset (slip, punch lead-in, comp displacement) wider
// than one scheduler window therefore plays none of its notes live.
describe('scheduleMidiNotes — Yeast track with a clip content offset', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        injectedWithheldDeviceTypes.clear();
        (trackStore as { value: unknown }).value = { tracks: [] };
        (midiStore as { value: unknown }).value = null;
        (automationStore as { value: unknown }).value = null;
        (tempoMapStore as { value: unknown }).value = { changes: [] };
        (timeSignatureMapStore as { value: unknown }).value = { changes: [] };
        vi.mocked(resolveClipsWithComping).mockImplementation((_trackId, clips) =>
            clips.map((clip) => ({
                ...clip,
                regionStartBeat: clip.startBeat,
                regionEndBeat: clip.endBeat,
                sourceStartBeat: clip.startBeat,
            }))
        );
        vi.mocked(projectClipMidiEvents).mockImplementation((input) =>
            input.events.map((event) => ({ ...event, startBeat: projectedStartBeat(input, event.startBeat) }))
        );
        vi.mocked(processYeastMidi).mockImplementation((input) => Promise.resolve([...input.events]));
        vi.mocked(projectCommittedGroove).mockImplementation(({ events }) => events);
        vi.mocked(ensureTrackStrip).mockImplementation(
            () =>
                ({
                    gainNode: {},
                    preFaderTap: { connect: vi.fn() },
                    deviceNodes: [],
                }) as never
        );
        shouldPlayProbability.mockImplementation(() => true);
    });

    type ScheduledVoice = { beat: number; durationBeats: number; pitch: number };

    // 120 BPM at 48 kHz: one beat lasts half a second, so a scheduled time or
    // duration in seconds converts to beats by doubling it.
    const BEATS_PER_SECOND = 2;
    // Production grain: a 10 ms tick is 0.02 beats at 120 BPM.
    const WINDOW_BEATS = 0.02;

    async function sweepScheduledVoices(
        midiOffsetBeats: number,
        options: {
            clip?: Record<string, unknown>;
            note?: { startBeat: number; duration: number };
            sweepEndBeat?: number;
        } = {}
    ): Promise<ScheduledVoice[]> {
        const note = { startBeat: 2.5, duration: 0.5, ...options.note };
        const track = midiTrack({
            clips: [midiClip({ midiOffsetBeats, ...options.clip })],
            devices: [{ id: 'yeast-rack', type: 'yeast' }],
        });
        (trackStore as { value: unknown }).value = { tracks: [track] };
        // Clip-content beat `note.startBeat`; audible at clip start + start − midiOffsetBeats.
        (midiStore as { value: unknown }).value = {
            notesByClipId: {
                'clip-1': [{ id: 'n1', pitch: 60, startBeat: note.startBeat, duration: note.duration, velocity: 100 }],
            },
        };
        vi.mocked(scheduleNote).mockClear();
        const windowCount = Math.round((options.sweepEndBeat ?? 4) / WINDOW_BEATS);
        for (let step = 0; step < windowCount; step++) {
            const fromBeat = step * WINDOW_BEATS;
            // `accumulatedPosition` is anchored at 0, so every scheduled time is
            // the note's absolute position from the transport start and the
            // sweep reads positions, not per-window offsets.
            await scheduleMidiNotes(
                fromBeat,
                fromBeat + WINDOW_BEATS,
                0,
                new Set<string>(),
                [],
                defaultTransportState,
                120
            );
        }
        return vi.mocked(scheduleNote).mock.calls.map((call) => ({
            pitch: call[2],
            beat: call[3] * BEATS_PER_SECOND,
            durationBeats: call[4] * BEATS_PER_SECOND,
        }));
    }

    it('schedules the note at its content position when the clip has no content offset', async () => {
        // The twin projects content 2.5 to `iterationStart + 2.5 − 0` inside
        // the iteration with its full 0.5-beat duration.
        expect(await sweepScheduledVoices(0)).toEqual([{ pitch: 60, beat: 2.5, durationBeats: 0.5 }]);
    });

    it('schedules the note at its audible beat when the clip content is offset by half a beat', async () => {
        // The twin projects content 2.5 to `iterationStart + 2.5 − 0.5` = 2.
        expect(await sweepScheduledVoices(0.5)).toEqual([{ pitch: 60, beat: 2, durationBeats: 0.5 }]);
    });

    it('schedules the note at its audible beat when the clip content is offset negatively', async () => {
        // The twin projects content 2.5 to `iterationStart + 2.5 + 0.5` = 3.
        expect(await sweepScheduledVoices(-0.5)).toEqual([{ pitch: 60, beat: 3, durationBeats: 0.5 }]);
    });

    it('schedules each loop iteration at its audible beat when a looped clip is offset', async () => {
        // The twin projects content 2.5 to `iterationStart + 2.5 − 0.5` per
        // iteration: 2 and 6, each with its full duration.
        expect(
            await sweepScheduledVoices(0.5, {
                clip: { endBeat: 8, loopEnabled: true, loopLength: 4 },
                sweepEndBeat: 8,
            })
        ).toEqual([
            { pitch: 60, beat: 2, durationBeats: 0.5 },
            { pitch: 60, beat: 6, durationBeats: 0.5 },
        ]);
    });

    it('clamps content displaced before the clip head to the clip start', async () => {
        // Content 0.25 with offset 0.5 is audible at −0.25. The twin's
        // non-looped segment clamps the start to the clip start and truncates
        // at the original end beat: [0, 0.25].
        expect(await sweepScheduledVoices(0.5, { note: { startBeat: 0.25, duration: 0.5 } })).toEqual([
            { pitch: 60, beat: 0, durationBeats: 0.25 },
        ]);
    });

    it('wraps looped content displaced before an iteration head to where the twin re-anchors it', async () => {
        // Content 0.25 with offset 0.5 is audible at −0.25 inside each loop
        // iteration. Clamping it to the iteration heads owns the note at [0, 4]
        // and loses it at every seam; the twin instead re-anchors a looped
        // negative relative start with
        // `((offset % loopLength) + loopLength) % loopLength`, landing each
        // occurrence at `iterationStart + 3.75`, and the release keeps the full
        // 0.5-beat duration from there, ringing across the seam.
        expect(
            await sweepScheduledVoices(0.5, {
                clip: { endBeat: 8, loopEnabled: true, loopLength: 4 },
                note: { startBeat: 0.25, duration: 0.5 },
                sweepEndBeat: 8,
            })
        ).toEqual([
            { pitch: 60, beat: 3.75, durationBeats: 0.5 },
            { pitch: 60, beat: 7.75, durationBeats: 0.5 },
        ]);
    });
});
