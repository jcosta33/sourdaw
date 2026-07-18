export type ControllerMapping = {
    id: string;
    controlType: 'pad' | 'knob' | 'fader' | 'button';
    controlIndex: number; // MIDI CC or note number
    channel: number;
    action: {
        type: 'parameter' | 'transport' | 'workflow';
        target?: string; // paramId or actionId
    };
};

export type ControllerProfile = {
    id: string;
    name: string;
    manufacturer: string;
    productId: string[]; // Match patterns for MIDI device names
    mappings: ControllerMapping[];
    scriptUrl?: string; // J2: URL to custom script
};

export const PUSH_2_PROFILE: ControllerProfile = {
    id: 'push-2',
    name: 'Push 2',
    manufacturer: 'Ableton',
    productId: ['Ableton Push 2'],
    mappings: [
        {
            id: 'play-button',
            controlType: 'button',
            controlIndex: 85,
            channel: 1,
            action: { type: 'transport', target: 'togglePlayback' },
        },
    ],
};
