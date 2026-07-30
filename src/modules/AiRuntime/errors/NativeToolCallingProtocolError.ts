export class NativeToolCallingProtocolError extends Error {
    override readonly name = 'NativeToolCallingProtocolError';
}

export function isNativeToolCallingProtocolError(error: unknown): error is NativeToolCallingProtocolError {
    return error instanceof Error && error.name === 'NativeToolCallingProtocolError';
}
