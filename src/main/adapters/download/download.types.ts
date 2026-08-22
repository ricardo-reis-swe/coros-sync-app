/** What the coordinator gets back. No yt-dlp vocabulary crosses this boundary. */
export type DownloadResult = {
    filePath: string;
    title: string;
};

export class DownloadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DownloadError';
    }
}
