import { projectCommittedGroove } from '#/modules/MIDI/useCases';
import { processYeastMidi } from '#/modules/Yeast/useCases';

import {
    beatToSamples,
    getTempoAtBeat,
    samplesToBeat,
    splitRangeAtTempoChanges,
    type TempoChange,
} from '../../models/TempoMap';
import { getBarBeatAtPosition, getTimeSignatureAtBeat, type TimeSignatureChange } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';

export type LiveYeastNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    channel?: number;
};

export type LiveYeastIteration = {
    routeId: string;
    clipId: string;
    iterationStartBeat: number;
    midiOffsetBeats: number;
    sourceNotes: readonly LiveYeastNote[];
};

type ProcessLiveYeastTrackBlockInput = {
    context: BaseAudioContext;
    rackId: string;
    trackId: string;
    iterations: readonly LiveYeastIteration[];
    fromBeat: number;
    toBeat: number;
    changes: readonly TempoChange[];
    timeSignatureChanges: TimeSignatureChange[];
    transport: TransportState;
    discontinuityEpoch?: number;
    isCurrent: () => boolean;
};

type ProcessLiveYeastTrackBlockOutput = {
    notesByRoute: Map<string, LiveYeastNote[]>;
    generatedNotes: LiveYeastNote[];
};

type LiveYeastMidiEvent = Awaited<ReturnType<typeof processYeastMidi>>[number];

type PendingLiveYeastNote = {
    indices: number[];
    cursor: number;
};

export async function processLiveYeastTrackBlock({
    context,
    rackId,
    trackId,
    iterations,
    fromBeat,
    toBeat,
    changes,
    timeSignatureChanges,
    transport,
    discontinuityEpoch,
    isCurrent,
}: ProcessLiveYeastTrackBlockInput): Promise<ProcessLiveYeastTrackBlockOutput | null> {
    const sampleRate = context.sampleRate;
    const tempoMap = {
        defaultTempo: transport.tempo,
        changes: changes
            .map(({ beat, tempo, curve }) => ({ beat, tempo, curve }))
            .sort((alpha, beta) => alpha.beat - beta.beat),
    };
    const processedEvents: LiveYeastMidiEvent[] = [];

    for (const block of splitRangeAtTempoChanges(changes, fromBeat, toBeat)) {
        if (!isCurrent()) {
            return null;
        }

        const blockTempo = getTempoAtBeat(changes, block.fromBeat, transport.tempo);
        const barBeat = getBarBeatAtPosition(
            timeSignatureChanges,
            block.fromBeat,
            transport.timeSignatureNumerator,
            transport.timeSignatureDenominator
        );
        const blockTimeSignature = getTimeSignatureAtBeat(
            timeSignatureChanges,
            block.fromBeat,
            transport.timeSignatureNumerator,
            transport.timeSignatureDenominator
        );
        const inputEvents: LiveYeastMidiEvent[] = [];

        for (const iteration of iterations) {
            for (const sourceNote of iteration.sourceNotes) {
                const [groovedNote] = projectCommittedGroove({
                    events: [sourceNote],
                    consumerType: 'clip',
                    consumerId: iteration.clipId,
                });
                if (!groovedNote) {
                    continue;
                }

                const noteStartBeat = iteration.iterationStartBeat + groovedNote.startBeat;
                const noteEndBeat = noteStartBeat + groovedNote.duration;
                const ownsNoteOn = noteStartBeat >= block.fromBeat && noteStartBeat < block.toBeat;
                const ownsNoteOff = noteEndBeat >= block.fromBeat && noteEndBeat < block.toBeat;
                if (ownsNoteOn) {
                    inputEvents.push({
                        timeSamples: beatToSamples(changes, noteStartBeat, transport.tempo, sampleRate),
                        trackId: iteration.routeId,
                        timePpq: noteStartBeat,
                        tempoBpm: getTempoAtBeat(changes, noteStartBeat, transport.tempo),
                        kind: {
                            type: 'noteOn',
                            channel: sourceNote.channel ?? 0,
                            note: groovedNote.pitch,
                            velocity: groovedNote.velocity,
                        },
                    });
                }
                if (ownsNoteOff) {
                    inputEvents.push({
                        timeSamples: beatToSamples(changes, noteEndBeat, transport.tempo, sampleRate),
                        trackId: iteration.routeId,
                        timePpq: noteEndBeat,
                        tempoBpm: getTempoAtBeat(changes, noteEndBeat, transport.tempo),
                        kind: { type: 'noteOff', channel: sourceNote.channel ?? 0, note: groovedNote.pitch },
                    });
                }
            }
        }

        const blockOutput = await processYeastMidi({
            context,
            rackId,
            routeId: trackId,
            trackId,
            events: inputEvents,
            blockStartSamples: beatToSamples(changes, block.fromBeat, transport.tempo, sampleRate),
            blockEndSamples: beatToSamples(changes, block.toBeat, transport.tempo, sampleRate),
            transport: {
                sampleRate,
                bpm: blockTempo,
                ppqPosition: block.fromBeat,
                isPlaying: true,
                barIndex: barBeat.bar - 1,
                beatInBar: barBeat.beat - 1 + barBeat.tick / 480,
                timeSigNum: blockTimeSignature.numerator,
                timeSigDen: blockTimeSignature.denominator,
                loopEnabled: transport.loopStart < transport.loopEnd,
                loopStartPpq: transport.loopStart,
                loopEndPpq: transport.loopEnd,
                discontinuityEpoch,
                tempoMap,
            },
            preserveInputTrackIds: true,
        });
        if (!isCurrent()) {
            return null;
        }
        processedEvents.push(...blockOutput);
    }

    const iterationsByRoute = new Map(iterations.map((iteration) => [iteration.routeId, iteration]));
    const notesByRoute = new Map<string, LiveYeastNote[]>();
    const generatedNotes: LiveYeastNote[] = [];
    const pendingByRouteAndPitch = new Map<string, PendingLiveYeastNote>();
    const orderedEvents = processedEvents.map((event, ordinal) => ({ event, ordinal }));
    orderedEvents.sort(
        (alpha, beta) => alpha.event.timeSamples - beta.event.timeSamples || alpha.ordinal - beta.ordinal
    );

    for (const { event, ordinal } of orderedEvents) {
        if (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff') {
            continue;
        }

        const iteration = event.trackId ? iterationsByRoute.get(event.trackId) : undefined;
        const routeId = iteration?.routeId ?? trackId;
        const noteKey = `${routeId}:${event.kind.channel}:${event.kind.note}`;
        const targetNotes = iteration ? (notesByRoute.get(routeId) ?? []) : generatedNotes;
        if (iteration && !notesByRoute.has(routeId)) {
            notesByRoute.set(routeId, targetNotes);
        }

        if (event.kind.type === 'noteOn') {
            const template = iteration?.sourceNotes[0] ?? {
                id: iteration?.clipId ?? trackId,
                pitch: 60,
                startBeat: 0,
                duration: 0,
                velocity: 100,
                probability: 100,
            };
            const eventPpq = event.timePpq ?? samplesToBeat(changes, event.timeSamples, transport.tempo, sampleRate);
            const pending = pendingByRouteAndPitch.get(noteKey) ?? { indices: [], cursor: 0 };
            pending.indices.push(targetNotes.length);
            pendingByRouteAndPitch.set(noteKey, pending);
            targetNotes.push({
                ...template,
                id: `${template.id}:yeast:${event.kind.note}:${event.timeSamples}:${ordinal}`,
                pitch: event.kind.note,
                velocity: event.kind.velocity,
                startBeat: eventPpq - (iteration?.midiOffsetBeats ?? 0),
                duration: 0.25,
            });
            continue;
        }

        const pending = pendingByRouteAndPitch.get(noteKey);
        if (!pending || pending.cursor >= pending.indices.length) {
            continue;
        }
        const noteIndex = pending.indices[pending.cursor++]!;
        const note = targetNotes[noteIndex]!;
        const eventPpq = event.timePpq ?? samplesToBeat(changes, event.timeSamples, transport.tempo, sampleRate);
        targetNotes[noteIndex] = {
            ...note,
            duration: Math.max(0, eventPpq - (iteration?.midiOffsetBeats ?? 0) - note.startBeat),
        };
    }

    return { notesByRoute, generatedNotes };
}
