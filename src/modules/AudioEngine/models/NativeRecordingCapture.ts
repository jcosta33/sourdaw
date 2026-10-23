/** The issuing transport owns beat geometry; the engine owns its admission fence. */
export type NativeRecordingGeometry = Readonly<{
    secondsAtBeat: (beat: number) => number;
    beatAtSeconds: (seconds: number) => number;
    isLooping: boolean;
    loopStart: number;
    loopEnd: number;
}>;

export type NativeRecordingAdmission = Readonly<{
    geometry: NativeRecordingGeometry | null;
    admittedBatch: number;
    serial: number;
    located: boolean;
}>;
