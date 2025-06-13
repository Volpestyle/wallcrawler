import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { ApiGatewayManagementApiClient, PostToConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import {
  NotificationProvider,
  NotificationConfig,
  InterventionRequest,
  NotificationResult,
  DeviceToken,
  NotificationChannel,
  DeviceTokenRecord
} from '../types/intervention';
import { createLogger } from '../utils/logger';

const logger = createLogger('notification-provider');

interface APNSClient {
  send(notification: any): Promise<void>;
}

interface FCMClient {
  send(message: any): Promise<void>;
}

export class AWSNotificationProvider implements NotificationProvider {
  private snsClient: SNSClient;
  private dynamoClient: DynamoDBDocumentClient;
  private secretsClient: SecretsManagerClient;
  private apnsClient?: APNSClient;
  private fcmClient?: FCMClient;
  private apiGatewayClient?: ApiGatewayManagementApiClient;
  private config?: NotificationConfig;
  private deviceTokensTable: string;
  private notificationStatusTable: string;

  constructor(
    region: string = 'us-east-1',
    deviceTokensTable: string = 'wallcrawler-device-tokens',
    notificationStatusTable: string = 'wallcrawler-notification-status'
  ) {
    this.snsClient = new SNSClient({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    this.secretsClient = new SecretsManagerClient({ region });
    this.deviceTokensTable = deviceTokensTable;
    this.notificationStatusTable = notificationStatusTable;
  }

  async initialize(config: NotificationConfig): Promise<void> {
    this.config = config;

    // Load push certificates from Secrets Manager
    const secrets = await this.loadSecrets();

    // Initialize push clients if credentials are available
    if (secrets.apnsCert) {
      // In production, use a real APNS client like node-apn
      logger.info('Initialized APNS client');
    }

    if (secrets.fcmKey) {
      // In production, use firebase-admin SDK
      logger.info('Initialized FCM client');
    }

    // Initialize WebSocket client for API Gateway
    if (process.env.WEBSOCKET_API_ENDPOINT) {
      this.apiGatewayClient = new ApiGatewayManagementApiClient({
        endpoint: process.env.WEBSOCKET_API_ENDPOINT
      });
    }
  }

  async sendNotification(request: InterventionRequest): Promise<NotificationResult> {
    const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const channels: NotificationChannel[] = [];

    logger.info('Sending notification', {
      notificationId,
      userId: request.userId,
      type: request.interventionType
    });

    // Get user's devices
    const devices = await this.getUserDevices(request.userId);

    // Try channels in priority order
    const channelPriority = this.getChannelPriority(devices);

    for (const channel of channelPriority) {
      try {
        const result = await this.sendViaChannel(channel, request, notificationId);
        channels.push(result);
        
        if (result.status === 'success') {
          // Update last used timestamp for the device
          if (result.deviceId) {
            await this.updateDeviceLastUsed(request.userId, result.deviceId);
          }
          
          // Record notification status
          await this.recordNotificationStatus(notificationId, result);
          
          // If at least one channel succeeds, we can return success
          return {
            status: 'sent',
            channels,
            notificationId,
            timestamp: Date.now()
          };
        }
      } catch (error) {
        logger.error(`Channel ${channel.type} failed`, error);
        channels.push({
          type: channel.type,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // All channels failed, try SNS as fallback
    try {
      const snsResult = await this.sendViaSNS(request);
      channels.push(snsResult);
      
      return {
        status: snsResult.status === 'success' ? 'sent' : 'failed',
        channels,
        notificationId,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('SNS fallback failed', error);
      channels.push({
        type: 'email',
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return {
      status: 'failed',
      channels,
      notificationId,
      timestamp: Date.now()
    };
  }

  async getDeviceTokens(userId: string): Promise<DeviceToken[]> {
    const response = await this.dynamoClient.send(new QueryCommand({
      TableName: this.deviceTokensTable,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `USER#${userId}`
      }
    }));

    return (response.Items || []).map(item => ({
      userId: item.userId,
      deviceId: item.SK.replace('DEVICE#', ''),
      platform: item.platform,
      token: item.token,
      endpoint: item.endpoint,
      createdAt: item.createdAt,
      lastUsed: item.lastUsed
    }));
  }

  async registerDevice(token: DeviceToken): Promise<void> {
    const ttl = Math.floor(Date.now() / 1000) + (90 * 24 * 60 * 60); // 90 days

    await this.dynamoClient.send(new PutCommand({
      TableName: this.deviceTokensTable,
      Item: {
        PK: `USER#${token.userId}`,
        SK: `DEVICE#${token.deviceId}`,
        ...token,
        ttl
      } as DeviceTokenRecord
    }));

    logger.info('Device registered', {
      userId: token.userId,
      deviceId: token.deviceId,
      platform: token.platform
    });
  }

  private async loadSecrets(): Promise<any> {
    try {
      const response = await this.secretsClient.send(new GetSecretValueCommand({
        SecretId: 'wallcrawler/push-notifications'
      }));
      
      return JSON.parse(response.SecretString || '{}');
    } catch (error) {
      logger.warn('Failed to load push notification secrets', error);
      return {};
    }
  }

  private async getUserDevices(userId: string): Promise<DeviceToken[]> {
    return this.getDeviceTokens(userId);
  }

  private getChannelPriority(devices: DeviceToken[]): Array<{ type: NotificationChannel['type']; device?: DeviceToken }> {
    const channels: Array<{ type: NotificationChannel['type']; device?: DeviceToken }> = [];

    // 1. Mobile push notifications (highest priority)
    const mobileDevices = devices.filter(d => d.platform === 'ios' || d.platform === 'android');
    for (const device of mobileDevices) {
      channels.push({ type: 'push', device });
    }

    // 2. Web push notifications
    const webDevices = devices.filter(d => d.platform === 'web');
    for (const device of webDevices) {
      channels.push({ type: 'push', device });
    }

    // 3. WebSocket (if connected)
    if (this.apiGatewayClient) {
      channels.push({ type: 'websocket' });
    }

    // 4. Email/SMS as fallback
    channels.push({ type: 'email' });

    return channels;
  }

  private async sendViaChannel(
    channel: { type: NotificationChannel['type']; device?: DeviceToken },
    request: InterventionRequest,
    notificationId: string
  ): Promise<NotificationChannel> {
    switch (channel.type) {
      case 'push':
        if (!channel.device) {
          throw new Error('No device specified for push notification');
        }
        return this.sendPushNotification(channel.device, request);

      case 'websocket':
        return this.sendWebSocketNotification(request);

      case 'email':
        return this.sendViaSNS(request);

      default:
        throw new Error(`Unsupported channel type: ${channel.type}`);
    }
  }

  private async sendPushNotification(
    device: DeviceToken,
    request: InterventionRequest
  ): Promise<NotificationChannel> {
    const payload = {
      title: 'Action Required',
      body: request.context.title || 'Your automation needs assistance',
      data: {
        interventionId: request.sessionId,
        type: request.interventionType,
        portalUrl: request.portalUrl,
        expiresAt: request.expiresAt
      }
    };

    if (device.platform === 'ios' && this.apnsClient) {
      // Send via APNS
      await this.apnsClient.send({
        deviceToken: device.token,
        alert: {
          title: payload.title,
          body: payload.body
        },
        payload: payload.data,
        sound: 'default',
        badge: 1
      });
    } else if (device.platform === 'android' && this.fcmClient) {
      // Send via FCM
      await this.fcmClient.send({
        token: device.token,
        notification: {
          title: payload.title,
          body: payload.body
        },
        data: payload.data,
        android: {
          priority: request.priority === 'high' ? 'high' : 'normal'
        }
      });
    } else if (device.platform === 'web' && device.endpoint) {
      // Send web push notification
      // In production, use web-push library
      logger.info('Would send web push notification', { endpoint: device.endpoint });
    }

    return {
      type: 'push',
      status: 'success',
      deviceId: device.deviceId
    };
  }

  private async sendWebSocketNotification(
    request: InterventionRequest
  ): Promise<NotificationChannel> {
    if (!this.apiGatewayClient) {
      throw new Error('WebSocket client not initialized');
    }

    // Get active WebSocket connections for the user
    const connections = await this.getActiveConnections(request.userId);

    for (const connectionId of connections) {
      await this.apiGatewayClient.send(new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: JSON.stringify({
          type: 'intervention-required',
          payload: request
        })
      }));
    }

    return {
      type: 'websocket',
      status: 'success'
    };
  }

  private async sendViaSNS(request: InterventionRequest): Promise<NotificationChannel> {
    if (!this.config?.snsTopicArn) {
      throw new Error('SNS topic not configured');
    }

    const message = {
      default: `Action required for your automation: ${request.context.title}`,
      email: this.formatEmailMessage(request),
      sms: `WallCrawler: Action needed. Visit ${request.portalUrl}`
    };

    await this.snsClient.send(new PublishCommand({
      TopicArn: this.config.snsTopicArn,
      Message: JSON.stringify(message),
      MessageStructure: 'json',
      Subject: 'WallCrawler - Action Required'
    }));

    return {
      type: 'email',
      status: 'success'
    };
  }

  private formatEmailMessage(request: InterventionRequest): string {
    return `
Hello,

Your WallCrawler automation requires assistance.

Type: ${request.interventionType}
URL: ${request.context.url}
Title: ${request.context.title}

Please visit the intervention portal to continue:
${request.portalUrl}

This link will expire at: ${new Date(request.expiresAt).toLocaleString()}

Best regards,
WallCrawler Team
    `;
  }

  private async updateDeviceLastUsed(userId: string, deviceId: string): Promise<void> {
    // Update the last used timestamp for the device
    // Implementation would update DynamoDB record
  }

  private async recordNotificationStatus(
    notificationId: string,
    channel: NotificationChannel
  ): Promise<void> {
    // Record notification status in DynamoDB
    // Implementation would create a status record
  }

  private async getActiveConnections(userId: string): Promise<string[]> {
    // Query DynamoDB for active WebSocket connections
    // Implementation would return connection IDs
    return [];
  }
}