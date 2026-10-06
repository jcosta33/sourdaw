/**
 * The two instruments that honour stored controllers, as the surface a device node
 * exposes for them (local shape: cross-module model isolation). Grand Boule takes
 * a sustain position and two latches; Levain takes the raw controller byte.
 *
 * Every move stored playback posts carries `stored`, so the engine can tell it from
 * a move a performer played: `discardStoredPedals` and `discardStoredCc` drop the
 * stored ones still waiting for their frame and never a performer's.
 */
export type StoredControllerNode = {
    grandBouleControls?: {
        setSustain: (position: number, sampleFrame?: number, stored?: boolean) => void;
        setSostenuto: (engaged: boolean, sampleFrame?: number, stored?: boolean) => void;
        setUnaCorda: (engaged: boolean, sampleFrame?: number, stored?: boolean) => void;
        discardStoredPedals?: () => void;
    };
    levainControls?: {
        handleCc: (cc: number, value: number, sampleFrame?: number, stored?: boolean) => void;
        discardStoredCc?: () => void;
    };
};
