import { Wallcrawler } from '@wallcrawler/sdk';
import type { SessionRetrieveResponse } from '@wallcrawler/sdk/resources/sessions/sessions';
import { Response } from 'node-fetch';

describe('Wallcrawler SDK response shape', () => {
  const baseURL = 'https://wallcrawler.test';
  const sampleSession: SessionRetrieveResponse = {
    id: 'sess_123',
    status: 'RUNNING',
    projectId: 'proj_123',
    region: 'us-east-1',
    keepAlive: false,
    proxyBytes: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:05:00.000Z',
    expiresAt: '2024-01-01T01:00:00.000Z',
    startedAt: '2024-01-01T00:00:30.000Z',
    connectUrl: 'wss://example.test/cdp',
    seleniumRemoteUrl: 'https://example.test/wd/hub',
    signingKey: 'jwt-token',
  };

  it('returns plain session objects without wrapping success metadata', async () => {
    const mockFetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(sampleSession), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const client = new Wallcrawler({
      apiKey: 'test',
      baseURL,
      fetch: mockFetch as any,
    });

    const session = await client.sessions.retrieve(sampleSession.id);

    expect(mockFetch).toHaveBeenCalledWith(
      `${baseURL}/v1/sessions/${sampleSession.id}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(session).toEqual(sampleSession);
    expect((session as unknown as Record<string, unknown>)).not.toHaveProperty('success');
  });
});
