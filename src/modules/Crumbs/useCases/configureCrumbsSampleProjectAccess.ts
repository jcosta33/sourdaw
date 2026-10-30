import { crumbsSampleProjectAccess } from '../stores/crumbsSampleProjectAccess';

/** Install the app's fresh owner reader and dispose only this registration. */
export function configureCrumbsSampleProjectAccess(capture: (deviceId: string) => number | null): () => void {
    crumbsSampleProjectAccess.current = capture;
    return () => {
        if (crumbsSampleProjectAccess.current === capture) {
            crumbsSampleProjectAccess.current = null;
        }
    };
}
