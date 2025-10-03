const createMock = jest.fn();
const retrieveMock = jest.fn();
const debugMock = jest.fn();

const stagehandPageStub = {
  page: {
    setViewportSize: jest.fn().mockResolvedValue(undefined),
  },
};

const contextStub = {
  addInitScript: jest.fn().mockResolvedValue(undefined),
  newCDPSession: jest
    .fn()
    .mockResolvedValue({ send: jest.fn().mockResolvedValue(undefined) }),
  close: jest.fn().mockResolvedValue(undefined),
  pages: jest.fn().mockReturnValue([]),
  browser: jest.fn(),
  on: jest.fn(),
};

const stagehandContextInstance = {
  context: contextStub,
  getStagehandPages: jest.fn().mockResolvedValue([stagehandPageStub]),
  getStagehandPage: jest.fn(),
  setActivePage: jest.fn(),
};

contextStub.browser.mockReturnValue({ contexts: () => [contextStub] });

jest.mock('@wallcrawler/sdk', () => ({
  Wallcrawler: jest.fn().mockImplementation(() => ({
    sessions: {
      create: createMock,
      retrieve: retrieveMock,
      debug: debugMock,
    },
  })),
  Browserbase: class {},
}));

jest.mock('playwright', () => {
  const browserStub = {
    contexts: () => [contextStub],
  };
  contextStub.browser.mockReturnValue(browserStub);
  return {
    chromium: {
      connectOverCDP: jest.fn().mockResolvedValue(browserStub),
    },
  };
});

jest.mock('../../stagehand/lib/StagehandContext', () => ({
  StagehandContext: class {
    static init = jest.fn().mockResolvedValue(stagehandContextInstance);
  },
}));

import { Stagehand } from '@wallcrawler/stagehand';

describe('Stagehand + Wallcrawler integration expectations', () => {
  const sampleSession = {
    id: 'sess_wc_001',
    status: 'RUNNING' as const,
    projectId: 'proj_abc',
    region: 'us-east-1' as const,
    keepAlive: false,
    proxyBytes: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:01:00.000Z',
    expiresAt: '2024-01-01T01:00:00.000Z',
    startedAt: '2024-01-01T00:00:10.000Z',
    connectUrl: 'wss://wallcrawler.test/session/cdp',
    seleniumRemoteUrl: 'https://wallcrawler.test/wd',
    signingKey: 'jwt-token',
  };

  const sampleDebug = {
    debuggerUrl: 'https://wallcrawler.test/debug',
    debuggerFullscreenUrl: 'https://wallcrawler.test/debug/full',
    wsUrl: 'wss://wallcrawler.test/debug/ws',
    pages: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WALLCRAWLER_API_URL = 'https://wallcrawler.test';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    createMock.mockResolvedValue(sampleSession);
    retrieveMock.mockResolvedValue(sampleSession);
    debugMock.mockResolvedValue(sampleDebug);
  });

  it('initialises using raw Wallcrawler session payloads', async () => {
    const stagehand = new Stagehand({
      env: 'WALLCRAWLER',
      apiKey: 'test-key',
      projectId: 'proj_abc',
      useAPI: false,
      disablePino: true,
      headless: true,
    });

    const initResult = await stagehand.init();

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      projectId: 'proj_abc',
      userMetadata: expect.objectContaining({ stagehand: 'true' }),
    });
    expect(debugMock).toHaveBeenCalledWith(sampleSession.id);
    expect(initResult.sessionId).toBe(sampleSession.id);
    expect(initResult.debugUrl).toBe(sampleDebug.debuggerUrl);
    expect(stagehandContextInstance.getStagehandPages).toHaveBeenCalled();
  });
});
