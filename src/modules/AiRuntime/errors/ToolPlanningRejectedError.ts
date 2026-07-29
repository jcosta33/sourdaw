export class ToolPlanningRejectedError extends Error {
    override readonly name = 'ToolPlanningRejectedError';
}

export function isToolPlanningRejectedError(error: unknown): error is ToolPlanningRejectedError {
    return error instanceof Error && error.name === 'ToolPlanningRejectedError';
}
