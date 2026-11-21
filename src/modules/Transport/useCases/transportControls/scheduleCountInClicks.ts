import { getAudioContext, scheduleClick } from '#/modules/AudioEngine/useCases';

export type CountIn = {
    beats: number;
    beatsPerBar: number;
    secondsPerBeat: number;
    volume: number;
};

/**
 * The clicks and the boundary they count to sit on the same audio clock, so both come from one
 * read: the take must open when this clock reaches the boundary, never when the JS timer wheel
 * gets around to it.
 */
export function scheduleCountInClicks(countIn: CountIn): { endTimeSec: number; durationSec: number } {
    const startTimeSec = getAudioContext().currentTime;
    for (let index = 0; index < countIn.beats; index++) {
        scheduleClick(startTimeSec + index * countIn.secondsPerBeat, index % countIn.beatsPerBar === 0, countIn.volume);
    }
    const durationSec = countIn.beats * countIn.secondsPerBeat;
    return { endTimeSec: startTimeSec + durationSec, durationSec };
}
