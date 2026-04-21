export type AppError<
    TTag extends string = string,
    TData extends Record<string, unknown> = Record<string, unknown>,
> = Error &
    Readonly<
        {
            _tag: TTag;
            message: string;
            cause?: unknown;
        } & TData
    >;

export const createAppError = <TTag extends string, TData extends Record<string, unknown> = Record<string, unknown>>(
    tag: TTag,
    message: string,
    data?: TData,
    cause?: unknown
): AppError<TTag, TData> => {
    const error = new Error(message) as any;
    error._tag = tag;
    Object.assign(error, data ?? {});
    if (cause !== undefined) {
        error.cause = cause;
    }
    return error as AppError<TTag, TData>;
};
