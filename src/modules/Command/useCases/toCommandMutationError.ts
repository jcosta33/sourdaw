export function toCommandMutationError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    return new Error('Command mutation rejected with a non-Error value', { cause: error });
}
