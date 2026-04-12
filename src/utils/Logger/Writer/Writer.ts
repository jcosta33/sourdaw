/* (c) Copyright Sourdaw Ltd., all rights reserved. */

type WriteErrorFn = (error: Error) => void;
export type WriteErrorParams = Parameters<WriteErrorFn>;

export type Writer = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: WriteErrorFn;
};
