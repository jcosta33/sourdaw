/**
 * The two instruments that honour stored controllers, as the surface a device node
 * exposes for them (local shape: cross-module model isolation). Grand Boule takes
 * a sustain position and two latches; Levain takes the raw controller byte.
 */
export type StoredControllerNode = {
    grandBouleControls?: {
        setSustain: (position: number, sampleFrame?: number) => void;
        setSostenuto: (engaged: boolean, sampleFrame?: number) => void;
        setUnaCorda: (engaged: boolean, sampleFrame?: number) => void;
    };
    levainControls?: {
        handleCc: (cc: number, value: number, sampleFrame?: number) => void;
    };
};
