import { generateAuthToken } from './auth';

const PORTAL_DOMAIN = process.env.PORTAL_DOMAIN || 'https://intervention.wallcrawler.com';

export async function generatePortalUrl(
  interventionId: string,
  sessionId: string
): Promise<string> {
  // Generate a secure token for the portal
  const token = await generateAuthToken({
    userId: 'system', // Will be replaced with actual user ID
    sessionId,
    interventionId,
    exp: Math.floor(Date.now() / 1000) + (30 * 60) // 30 minutes
  });

  // Create portal URL with token
  const portalUrl = new URL(`/intervention/${interventionId}`, PORTAL_DOMAIN);
  portalUrl.searchParams.set('token', token);
  
  return portalUrl.toString();
}