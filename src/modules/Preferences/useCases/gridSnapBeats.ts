import { type GridSnapOption } from '../models/Preferences';

const GRID_SNAP_OPTIONS: ReadonlyArray<{ value: GridSnapOption; beats: number }> = [
    { value: 'bar', beats: 4 },
    { value: 'beat', beats: 1 },
    { value: '1/2', beats: 0.5 },
    { value: '1/4', beats: 0.25 },
    { value: '1/8', beats: 0.125 },
    { value: '1/16', beats: 0.0625 },
    { value: '1/32', beats: 0.03125 },
    { value: '1/4T', beats: 1 / 3 },
    { value: '1/8T', beats: 1 / 6 },
    { value: '1/16T', beats: 1 / 12 },
    { value: '1/4D', beats: 0.375 },
    { value: '1/8D', beats: 0.1875 },
    { value: 'off', beats: 0 },
];

export function gridSnapBeats(option: GridSnapOption): number {
    const entry = GRID_SNAP_OPTIONS.find((gridOption) => gridOption.value === option);
    return entry?.beats ?? 0;
}
