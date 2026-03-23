export type TransitionStyle = 'drum-fill' | 'riser' | 'sweep-down' | 'crash' | 'reverse-cymbal' | 'build' | 'breakdown';

export type GeneratedFill = {
    notes: Array<{ pitch: number; startBeat: number; duration: number; velocity: number }>;
    durationBeats: number;
    style: TransitionStyle;
    confidence: number;
};
