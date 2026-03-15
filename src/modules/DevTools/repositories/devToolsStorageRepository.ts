export const getEventLoggingEnabled = (): boolean => {
    if (typeof window === "undefined") {
        return false;
    }
    try {
        const settings = localStorage.getItem("frontify-devtools-settings");
        if (!settings) {
            return false;
        }
        const parsed = JSON.parse(settings);
        return parsed?.eventLogging === true;
    } catch {
        return false;
    }
};
