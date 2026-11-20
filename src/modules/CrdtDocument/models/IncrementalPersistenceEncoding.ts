import { type Heads } from '@automerge/automerge';

export type IncrementalEncodingInput = {
    id: string;
    seed: Uint8Array<ArrayBuffer>;
    heads: Heads;
    frontier: Heads;
};

export type EncodedIncremental = {
    id: string;
    chunk: Uint8Array<ArrayBuffer>;
    heads: Heads;
};
