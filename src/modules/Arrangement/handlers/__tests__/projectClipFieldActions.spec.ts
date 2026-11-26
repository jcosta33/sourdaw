import { describe, expect, it } from 'vitest';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { type Clip, createTrack, type Track } from '../../models/Track';
import {
    findProjectedClip,
    projectClipColor,
    projectClipEnd,
    projectClipFade,
    projectClipLock,
    projectClipMute,
    projectClipNudge,
    projectClipSlip,
    projectMidiClipStart,
    slippedMidiOffset,
    trimmedStartBeat,
} from '../projectClipFieldActions';

function trackWith(...clips: Clip[]): Track {
    return { ...createTrack({ id: 'track-1', kind: 'audio', name: 'T' }), clips };
}

describe('projectClipFieldActions', () => {
    it('finds a clip by id and nothing for an unknown id', () => {
        const clip = ClipDummy.create({ id: 'c1' });

        expect(findProjectedClip(trackWith(clip), 'c1')).toBe(clip);
        expect(findProjectedClip(trackWith(clip), 'other')).toBeUndefined();
    });

    it('projects mute, lock and colour onto the named clip only', () => {
        const target = ClipDummy.create({ id: 'c1' });
        const bystander = ClipDummy.create({ id: 'c2' });
        const projected = trackWith(target, bystander);

        projectClipMute({ type: 'muteClip', payload: { clipId: 'c1', muted: true } }, projected);
        projectClipLock({ type: 'lockClip', payload: { clipId: 'c1', locked: true } }, projected);
        projectClipColor({ type: 'setClipColor', payload: { clipId: 'c1', color: '#123456' } }, projected);

        expect(target).toMatchObject({ muted: true, locked: true, color: '#123456' });
        expect(bystander).toMatchObject({ muted: false, locked: false, color: '#ff0000' });
    });

    it('leaves the track alone when mute, lock, colour or fade name a clip it does not hold', () => {
        const clip = ClipDummy.create({ id: 'c1' });
        const projected = trackWith(clip);
        const before = structuredClone(projected);

        projectClipMute({ type: 'muteClip', payload: { clipId: 'x', muted: true } }, projected);
        projectClipLock({ type: 'lockClip', payload: { clipId: 'x', locked: true } }, projected);
        projectClipColor({ type: 'setClipColor', payload: { clipId: 'x', color: '#123456' } }, projected);
        projectClipFade({ type: 'setClipFade', payload: { clipId: 'x', fadeInBeats: 1, fadeOutBeats: 1 } }, projected);

        expect(projected).toEqual(before);
    });

    it('projects an audio fade clamped at zero and skips a MIDI clip', () => {
        const audio = ClipDummy.create({ id: 'a', type: 'audio' });
        const midi = ClipDummy.create({ id: 'm', type: 'midi' });
        const projected = trackWith(audio, midi);

        projectClipFade(
            { type: 'setClipFade', payload: { clipId: 'a', fadeInBeats: -2, fadeOutBeats: 1.5 } },
            projected
        );
        projectClipFade({ type: 'setClipFade', payload: { clipId: 'm', fadeInBeats: 1, fadeOutBeats: 1 } }, projected);

        expect(audio).toMatchObject({ fadeInBeats: 0, fadeOutBeats: 1.5 });
        expect(midi).toMatchObject({ fadeInBeats: 0, fadeOutBeats: 0 });
    });

    it('projects a clip end only when it is finite and after the start', () => {
        const clip = ClipDummy.create({ id: 'c1', startBeat: 2, endBeat: 6 });
        const projected = trackWith(clip);

        projectClipEnd({ type: 'trimClipEnd', payload: { clipId: 'c1', newEndBeat: Number.NaN } }, projected);
        projectClipEnd({ type: 'trimClipEnd', payload: { clipId: 'c1', newEndBeat: 2 } }, projected);
        projectClipEnd({ type: 'trimClipEnd', payload: { clipId: 'missing', newEndBeat: 9 } }, projected);
        expect(clip.endBeat).toBe(6);

        projectClipEnd({ type: 'trimClipEnd', payload: { clipId: 'c1', newEndBeat: 5 } }, projected);
        expect(clip.endBeat).toBe(5);
    });

    it('projects a nudge with its anchors and drops an anchor the plan no longer carries', () => {
        const anchored = ClipDummy.create({
            id: 'c1',
            startBeat: 2,
            endBeat: 6,
            loopOriginBeat: 1,
            audioLoopPassOriginBeat: 3,
        });
        const projected = trackWith(anchored);

        projectClipNudge({ type: 'nudgeClip', payload: { clipId: 'c1', beats: 1 } }, projected);
        expect(anchored).toMatchObject({
            startBeat: 3,
            endBeat: 7,
            loopOriginBeat: 2,
            audioLoopPassOriginBeat: 4,
        });

        projectClipNudge(
            { type: 'nudgeClip', payload: { clipId: 'c1', beats: 0, placement: { startBeat: 5, endBeat: 9 } } },
            projected
        );
        expect(anchored.startBeat).toBe(5);
        expect(Object.hasOwn(anchored, 'loopOriginBeat')).toBe(false);
        expect(Object.hasOwn(anchored, 'audioLoopPassOriginBeat')).toBe(false);
    });

    it('leaves the track alone when a nudge names a clip it does not hold', () => {
        const projected = trackWith(ClipDummy.create({ id: 'c1', startBeat: 2, endBeat: 6 }));
        const before = structuredClone(projected);

        projectClipNudge({ type: 'nudgeClip', payload: { clipId: 'missing', beats: 1 } }, projected);

        expect(projected).toEqual(before);
    });

    it('projects only a finite MIDI slip and skips an audio slip or an unknown clip', () => {
        const midi = ClipDummy.create({ id: 'm', type: 'midi', midiOffsetBeats: 0 });
        const projected = trackWith(midi);

        projectClipSlip({ type: 'slipClipContent', payload: { clipId: 'm', clipType: 'audio', offset: 1 } }, projected);
        projectClipSlip(
            { type: 'slipClipContent', payload: { clipId: 'm', clipType: 'midi', offset: Number.NaN } },
            projected
        );
        projectClipSlip({ type: 'slipClipContent', payload: { clipId: 'x', clipType: 'midi', offset: 1 } }, projected);
        expect(midi.midiOffsetBeats).toBe(0);

        projectClipSlip({ type: 'slipClipContent', payload: { clipId: 'm', clipType: 'midi', offset: 1 } }, projected);
        expect(midi.midiOffsetBeats).toBe(1);
    });

    it('wraps a fresh slip into the loop and restores a recorded one verbatim', () => {
        const looped = ClipDummy.create({ type: 'midi', startBeat: 0, endBeat: 16, loopEnabled: true, loopLength: 8 });

        expect(slippedMidiOffset({ clipId: looped.id, clipType: 'midi', offset: 10 }, looped)).toBe(2);
        expect(slippedMidiOffset({ clipId: looped.id, clipType: 'midi', offset: 10, rowLiftBeats: 0 }, looped)).toBe(
            10
        );
    });

    it('reads the head a start trim leaves and keeps the head when the trim is not finite or planned', () => {
        const clip = ClipDummy.create({ type: 'midi', startBeat: 2, endBeat: 8, midiOffsetBeats: 0 });

        expect(trimmedStartBeat(clip, 4)).toBe(4);
        expect(trimmedStartBeat(clip, Number.NaN)).toBe(2);
        expect(trimmedStartBeat(clip, 8)).toBe(2);
        expect(trimmedStartBeat({ ...clip, midiOffsetBeats: Number.POSITIVE_INFINITY }, 4)).toBe(2);
    });

    it('projects a MIDI start trim and skips an audio clip, a missing clip and a non-finite start', () => {
        const midi = ClipDummy.create({ id: 'm', type: 'midi', startBeat: 0, endBeat: 8, midiOffsetBeats: 0 });
        const audio = ClipDummy.create({ id: 'a', type: 'audio', startBeat: 0, endBeat: 8 });
        const projected = trackWith(midi, audio);

        projectMidiClipStart({ type: 'trimClipStart', payload: { clipId: 'a', newStartBeat: 2 } }, projected);
        projectMidiClipStart({ type: 'trimClipStart', payload: { clipId: 'x', newStartBeat: 2 } }, projected);
        projectMidiClipStart({ type: 'trimClipStart', payload: { clipId: 'm', newStartBeat: Number.NaN } }, projected);
        expect(projected.clips[1]?.startBeat).toBe(0);
        expect(projected.clips[0]).toMatchObject({ startBeat: 0, midiOffsetBeats: 0 });

        projectMidiClipStart({ type: 'trimClipStart', payload: { clipId: 'm', newStartBeat: 2 } }, projected);
        expect(projected.clips[0]).toMatchObject({ startBeat: 2, midiOffsetBeats: 2 });
    });

    it('leaves a MIDI clip alone when its start trim is refused or plans nothing', () => {
        const midi = ClipDummy.create({
            id: 'm',
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
            midiOffsetBeats: Number.POSITIVE_INFINITY,
        });
        const projected = trackWith(midi);
        const before = structuredClone(projected);

        projectMidiClipStart({ type: 'trimClipStart', payload: { clipId: 'm', newStartBeat: 2 } }, projected);
        projectMidiClipStart({ type: 'trimClipStart', payload: { clipId: 'm', newStartBeat: 9 } }, projected);

        expect(projected).toEqual(before);
    });
});
