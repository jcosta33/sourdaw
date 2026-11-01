import { type RenderedFactorySample } from './RenderedFactorySample';

export type FactorySynthesisWorkerRequest = { type: 'render' };

export type FactorySynthesisWorkerReply =
    { status: 'complete'; samples: RenderedFactorySample[] } | { status: 'failed' };

export type FactorySynthesisWorkerResult =
    | { status: 'complete'; samples: RenderedFactorySample[] }
    | { status: 'failed'; code: 'render-failed' | 'render-timed-out' };
