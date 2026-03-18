/* (c) Copyright Webdaw Ltd., all rights reserved. */

type WriteErrorFn = (error: Error) => void;
export type WriteErrorParams = Parameters<WriteErrorFn>;

export interface Writer {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: WriteErrorFn;
}
