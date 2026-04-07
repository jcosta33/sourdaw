export type AppError<
    TTag extends string = string,
    TData extends Record<string, unknown> = Record<string, unknown>,
> = Readonly<
    {
        _tag: TTag;
        message: string;
        cause?: unknown;
    } & TData
>;

export const createAppError = <
    TTag extends string,
    TData extends Record<string, unknown> = Record<string, unknown>,
>(
    tag: TTag,
    message: string,
    data?: TData,
    cause?: unknown,
): AppError<TTag, TData> => {
    return {
        _tag: tag,
        message,
        ...(data ?? ({} as TData)),
        ...(cause !== undefined ? { cause } : {}),
    };
};