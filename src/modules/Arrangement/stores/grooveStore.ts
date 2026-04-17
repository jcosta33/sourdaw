import { createStore } from '#/infra/store/createStore';

/**
 * Groove template — defined as a sequence of timing offsets (in beats).
 * R-H4: Groove templates library.
 */
export type GrooveTemplate = {
    id: string;
    name: string;
    /** Sequence of micro-timing offsets (-0.25 to 0.25 beats) */
    offsets: number[];
    resolution: number; // e.g., 0.25 for 16th notes
};

export type GrooveState = {
    templates: GrooveTemplate[];
    /** Project-wide groove settings */
    projectGrooveId: string | null;
    projectGrooveIntensity: number; // 0 to 1
};

export const grooveStore = createStore<GrooveState>({
    initialData: {
        templates: [
            {
                id: 'swing-16th',
                name: 'Swing 16th',
                offsets: [0, 0.05, 0, 0.05],
                resolution: 0.25,
            },
        ],
        projectGrooveId: null,
        projectGrooveIntensity: 0.5,
    },
});
