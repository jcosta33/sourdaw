import type { LaunchOptions } from 'playwright';

type GetRenderDeadlineBrowserLaunchOptionsInput = {
    headed: boolean;
};

export function getRenderDeadlineBrowserLaunchOptions({
    headed,
}: GetRenderDeadlineBrowserLaunchOptionsInput): LaunchOptions {
    return {
        channel: 'chrome',
        headless: !headed,
        args: ['--autoplay-policy=no-user-gesture-required'],
    };
}

type LaunchRenderDeadlineBrowserInput<TBrowser> = GetRenderDeadlineBrowserLaunchOptionsInput & {
    launchBrowser: (options: LaunchOptions) => Promise<TBrowser>;
};

export type LaunchRenderDeadlineBrowserResult<TBrowser> =
    | { status: 'launched'; browser: TBrowser }
    | {
          status: 'not-measured';
          error: unknown;
      };

function isStableChromeMissing(error: unknown): boolean {
    return error instanceof Error && error.message.includes("Chromium distribution 'chrome' is not found");
}

export async function launchRenderDeadlineBrowser<TBrowser>({
    headed,
    launchBrowser,
}: LaunchRenderDeadlineBrowserInput<TBrowser>): Promise<LaunchRenderDeadlineBrowserResult<TBrowser>> {
    try {
        const browser = await launchBrowser(getRenderDeadlineBrowserLaunchOptions({ headed }));
        return { status: 'launched', browser };
    } catch (error: unknown) {
        if (!isStableChromeMissing(error)) {
            throw error;
        }
        return { status: 'not-measured', error };
    }
}
