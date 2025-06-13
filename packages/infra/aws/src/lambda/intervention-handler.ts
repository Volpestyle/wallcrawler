import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AWSNotificationProvider } from '../intervention/notification-provider';
import { 
  InterventionEvent,
  InterventionType, 
  InterventionRequest,
  InterventionRecord 
} from '../types/intervention';
import { createLogger } from '../utils/logger';
import { generatePortalUrl } from '../utils/portal';

const logger = createLogger('intervention-handler');

const notificationProvider = new AWSNotificationProvider();
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const interventionsTable = process.env.INTERVENTIONS_TABLE || 'wallcrawler-interventions';

interface InterventionHandlerRequest {
  sessionId: string;
  userId: string;
  interventionEvent: InterventionEvent;
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const request: InterventionHandlerRequest = JSON.parse(event.body || '{}');
    
    logger.info('Handling intervention event', {
      sessionId: request.sessionId,
      userId: request.userId,
      type: request.interventionEvent.type,
      url: request.interventionEvent.url
    });

    // Generate intervention ID and portal URL
    const interventionId = `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = Date.now() + (30 * 60 * 1000); // 30 minutes
    const portalUrl = await generatePortalUrl(interventionId, request.sessionId);

    // Store intervention record
    const interventionRecord: InterventionRecord = {
      PK: `INTERVENTION#${interventionId}`,
      SK: `SESSION#${request.sessionId}`,
      userId: request.userId,
      type: request.interventionEvent.type,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt,
      ttl: Math.floor(expiresAt / 1000),
      portalUrl,
      context: {
        url: request.interventionEvent.url,
        title: request.interventionEvent.title,
        elements: request.interventionEvent.elements,
        screenshot: request.interventionEvent.screenshot,
        suggestedAction: request.interventionEvent.suggestedAction,
        metadata: request.interventionEvent.metadata
      }
    };

    await dynamoClient.send(new PutCommand({
      TableName: interventionsTable,
      Item: interventionRecord
    }));

    // Send notification to user
    const notificationRequest: InterventionRequest = {
      sessionId: request.sessionId,
      userId: request.userId,
      interventionType: request.interventionEvent.type,
      portalUrl,
      expiresAt,
      context: {
        url: request.interventionEvent.url,
        title: request.interventionEvent.title,
        elements: request.interventionEvent.elements,
        ...(request.interventionEvent.screenshot && { screenshot: request.interventionEvent.screenshot })
      },
      priority: getPriorityForType(request.interventionEvent.type)
    };

    const notificationResult = await notificationProvider.sendNotification(notificationRequest);

    logger.info('Intervention session created and notification sent', {
      interventionId,
      sessionId: request.sessionId,
      type: request.interventionEvent.type,
      notificationStatus: notificationResult.status
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        interventionId,
        portalUrl,
        expiresAt,
        notificationStatus: notificationResult.status
      })
    };
  } catch (error) {
    logger.error('Intervention handling failed', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
}

function getPriorityForType(type: InterventionType): 'high' | 'normal' | 'low' {
  switch (type) {
    case InterventionType.TWO_FACTOR:
    case InterventionType.RATE_LIMIT:
      return 'high'; // Time-sensitive
    
    case InterventionType.LOGIN:
    case InterventionType.CAPTCHA:
      return 'normal';
    
    case InterventionType.COOKIE_CONSENT:
    case InterventionType.GDPR_CONSENT:
    case InterventionType.PAYWALL:
      return 'low';
    
    default:
      return 'normal';
  }
}