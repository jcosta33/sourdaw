let next_run_token = 0;
let current_run_token: number | null = null;

export function beginMixAnalysisRun(): number {
    next_run_token += 1;
    current_run_token = next_run_token;
    return current_run_token;
}

export function isCurrentMixAnalysisRun(token: number): boolean {
    return current_run_token === token;
}
