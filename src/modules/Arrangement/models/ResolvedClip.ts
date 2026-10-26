import { type Clip } from './Track';

export type ResolvedClip = Clip & {
    regionStartBeat: number;
    regionEndBeat: number;
    sourceStartBeat: number;
};
