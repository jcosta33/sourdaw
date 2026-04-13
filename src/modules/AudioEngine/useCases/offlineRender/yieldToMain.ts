/** Yield to the main thread so the UI can update. */
export function yieldToMain(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
