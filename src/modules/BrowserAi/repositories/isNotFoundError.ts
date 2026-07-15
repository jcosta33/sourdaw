export function isNotFoundError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'NotFoundError';
}
