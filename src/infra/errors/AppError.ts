export type AppError<
    TTag extends string = string,
    TData extends Record<string, unknown> = Record<string, unknown>
> = Readonly<
    {
        _tag: TTag;
        message: string;
        cause?: unknown;
    } & TData
>;

export const createAppError = <
    TTag extends string,
    TData extends Record<string, unknown> = Record<string, unknown>
>(
    tag: TTag,
    message: string,
    data?: TData,
    cause?: unknown
): AppError<TTag, TData> => {
    return {
        _tag: tag,
        message,
        ...(data ?? ({} as TData)),
        ...(cause !== undefined ? { cause } : {}),
    };
};

export const isAppError = (value: unknown): value is AppError => {
    return (
        typeof value === 'object' &&
        value !== null &&
        '_tag' in value &&
        typeof (value as any)._tag === 'string' &&
        'message' in value &&
        typeof (value as any).message === 'string'
    );
};
