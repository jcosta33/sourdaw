type GetDroppedCrumbsFilePathInput = {
    file: File;
};

export function getDroppedCrumbsFilePath({ file }: GetDroppedCrumbsFilePathInput): string | null {
    const desktopPath = 'path' in file && typeof file.path === 'string' ? file.path : '';
    if (desktopPath.length > 0) {
        return desktopPath;
    }

    const browserPath = typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath : '';
    if (browserPath.length > 0) {
        return browserPath;
    }

    if (file.name.length > 0) {
        return file.name;
    }

    return null;
}
