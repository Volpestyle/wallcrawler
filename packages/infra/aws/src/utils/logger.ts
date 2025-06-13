import pino from 'pino';

export function createLogger(name: string) {
  return pino({
    name: `wallcrawler-aws:${name}`,
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}