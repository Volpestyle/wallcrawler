export class WallcrawlerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WallcrawlerError';
    }
} 