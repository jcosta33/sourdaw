type ProjectRealtimeMidiEventSampleTimeInput = {
    inputSampleTime: number;
    inputPpq: number;
    eventPpq: number;
    projectPpqToSamples: (ppq: number) => number;
};

export function projectRealtimeMidiEventSampleTime({
    inputSampleTime,
    inputPpq,
    eventPpq,
    projectPpqToSamples,
}: ProjectRealtimeMidiEventSampleTimeInput): number {
    const inputTimelineSamples = projectPpqToSamples(inputPpq);
    const eventTimelineSamples = projectPpqToSamples(eventPpq);
    return inputSampleTime + eventTimelineSamples - inputTimelineSamples;
}
