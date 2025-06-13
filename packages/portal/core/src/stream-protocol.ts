import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import { 
  PortalMessage, 
  PortalMessageType,
  PortalBrowserState,
  PortalCommand,
  PortalEvent 
} from 'wallcrawler/types/portal';

// Message schemas for validation
const BaseMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.number(),
  sessionId: z.string(),
  payload: z.any(),
  metadata: z.object({
    source: z.string(),
    version: z.string(),
    compression: z.string().optional(),
    encryption: z.string().optional()
  }).optional()
});

const BrowserStateMessageSchema = BaseMessageSchema.extend({
  type: z.literal('browser-state'),
  payload: z.any() // PortalBrowserState schema would go here
});

const CommandMessageSchema = BaseMessageSchema.extend({
  type: z.literal('command'),
  payload: z.any() // PortalCommand schema would go here
});

const EventMessageSchema = BaseMessageSchema.extend({
  type: z.literal('event'),
  payload: z.any() // PortalEvent schema would go here
});

/**
 * Stream Protocol
 * 
 * Handles the streaming protocol for real-time communication between
 * the portal and automation system. Manages message serialization,
 * compression, buffering, and error recovery.
 */
export class StreamProtocol extends EventEmitter {
  private sessionId: string;
  private messageBuffer: PortalMessage[] = [];
  private bufferSize: number;
  private compressionEnabled: boolean;
  private encryptionEnabled: boolean;
  private messageIdCounter = 0;
  private acknowledgementMap = new Map<string, number>();
  private retryMap = new Map<string, { message: PortalMessage; attempts: number; nextRetry: number }>();
  private maxRetries = 3;
  private retryDelayMs = 1000;
  private ackTimeoutMs = 5000;

  constructor(sessionId: string, options: StreamProtocolOptions = {}) {
    super();
    this.sessionId = sessionId;
    this.bufferSize = options.bufferSize || 100;
    this.compressionEnabled = options.enableCompression || false;
    this.encryptionEnabled = options.enableEncryption || false;
    
    // Start retry timer
    this.startRetryTimer();
  }

  /**
   * Send a browser state update
   */
  sendBrowserState(state: PortalBrowserState): PortalMessage {
    const message = this.createMessage('browser-state', state);
    this.addToBuffer(message);
    this.emit('messageSent', message);
    return message;
  }

  /**
   * Send a command
   */
  sendCommand(command: PortalCommand): PortalMessage {
    const message = this.createMessage('command', command);
    this.addToBuffer(message);
    this.emit('messageSent', message);
    return message;
  }

  /**
   * Send an event
   */
  sendEvent(event: PortalEvent): PortalMessage {
    const message = this.createMessage('event', event);
    this.addToBuffer(message);
    this.emit('messageSent', message);
    return message;
  }

  /**
   * Send a ping message
   */
  sendPing(): PortalMessage {
    const message = this.createMessage('ping', { timestamp: Date.now() });
    this.emit('messageSent', message);
    return message;
  }

  /**
   * Send a pong response
   */
  sendPong(pingId: string): PortalMessage {
    const message = this.createMessage('pong', { 
      pingId, 
      timestamp: Date.now() 
    });
    this.emit('messageSent', message);
    return message;
  }

  /**
   * Process an incoming raw message
   */
  processIncomingMessage(rawMessage: string | Buffer): void {
    try {
      const messageData = this.deserializeMessage(rawMessage);
      const message = this.validateMessage(messageData);
      
      this.emit('messageReceived', message);
      
      // Handle different message types
      switch (message.type) {
        case 'browser-state':
          this.handleBrowserStateMessage(message);
          break;
          
        case 'command':
          this.handleCommandMessage(message);
          break;
          
        case 'event':
          this.handleEventMessage(message);
          break;
          
        case 'ping':
          this.handlePingMessage(message);
          break;
          
        case 'pong':
          this.handlePongMessage(message);
          break;
          
        case 'error':
          this.handleErrorMessage(message);
          break;
          
        default:
          this.emit('unknownMessage', message);
      }
      
    } catch (error) {
      this.emit('messageError', error, rawMessage);
    }
  }

  /**
   * Serialize a message for transmission
   */
  serializeMessage(message: PortalMessage): string | Buffer {
    try {
      let data = JSON.stringify(message);
      
      if (this.compressionEnabled) {
        data = this.compressData(data);
      }
      
      if (this.encryptionEnabled) {
        data = this.encryptData(data);
      }
      
      return data;
      
    } catch (error) {
      this.emit('serializationError', error, message);
      throw error;
    }
  }

  /**
   * Get buffered messages for batch sending
   */
  getBufferedMessages(maxCount?: number): PortalMessage[] {
    const count = maxCount || this.messageBuffer.length;
    return this.messageBuffer.splice(0, count);
  }

  /**
   * Clear the message buffer
   */
  clearBuffer(): void {
    this.messageBuffer = [];
    this.emit('bufferCleared');
  }

  /**
   * Get buffer status
   */
  getBufferStatus(): { count: number; size: number; maxSize: number } {
    return {
      count: this.messageBuffer.length,
      size: this.messageBuffer.length,
      maxSize: this.bufferSize
    };
  }

  /**
   * Acknowledge receipt of a message
   */
  acknowledgeMessage(messageId: string): void {
    if (this.retryMap.has(messageId)) {
      this.retryMap.delete(messageId);
      this.emit('messageAcknowledged', messageId);
    }
  }

  /**
   * Mark a message as failed
   */
  markMessageFailed(messageId: string, error: Error): void {
    if (this.retryMap.has(messageId)) {
      const retryInfo = this.retryMap.get(messageId)!;
      this.emit('messageFailed', retryInfo.message, error, retryInfo.attempts);
    }
  }

  /**
   * Get protocol statistics
   */
  getStatistics(): StreamProtocolStats {
    return {
      sessionId: this.sessionId,
      messagesBuffered: this.messageBuffer.length,
      messagesAwaitingAck: this.retryMap.size,
      compressionEnabled: this.compressionEnabled,
      encryptionEnabled: this.encryptionEnabled,
      bufferUtilization: this.messageBuffer.length / this.bufferSize
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clearBuffer();
    this.retryMap.clear();
    this.acknowledgementMap.clear();
    this.removeAllListeners();
  }

  private createMessage(type: PortalMessageType, payload: any): PortalMessage {
    return {
      id: this.generateMessageId(),
      type,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      payload,
      metadata: {
        source: 'portal-core',
        version: '1.0.0',
        ...(this.compressionEnabled ? { compression: 'gzip' } : {}),
        ...(this.encryptionEnabled ? { encryption: 'aes256' } : {})
      }
    };
  }

  private addToBuffer(message: PortalMessage): void {
    // If buffer is full, remove oldest message
    if (this.messageBuffer.length >= this.bufferSize) {
      const removed = this.messageBuffer.shift();
      this.emit('messageDropped', removed);
    }
    
    this.messageBuffer.push(message);
    
    // Add to retry map for acknowledgement tracking
    this.retryMap.set(message.id, {
      message,
      attempts: 0,
      nextRetry: Date.now() + this.ackTimeoutMs
    });
  }

  private deserializeMessage(rawMessage: string | Buffer): any {
    let data = rawMessage.toString();
    
    if (this.encryptionEnabled) {
      data = this.decryptData(data);
    }
    
    if (this.compressionEnabled) {
      data = this.decompressData(data);
    }
    
    return JSON.parse(data);
  }

  private validateMessage(messageData: any): PortalMessage {
    // Basic validation
    const baseMessage = BaseMessageSchema.parse(messageData);
    
    // Type-specific validation
    switch (baseMessage.type) {
      case 'browser-state':
        return BrowserStateMessageSchema.parse(messageData);
      case 'command':
        return CommandMessageSchema.parse(messageData);
      case 'event':
        return EventMessageSchema.parse(messageData);
      default:
        return baseMessage as PortalMessage;
    }
  }

  private handleBrowserStateMessage(message: PortalMessage): void {
    this.emit('browserStateReceived', message.payload, message);
  }

  private handleCommandMessage(message: PortalMessage): void {
    this.emit('commandReceived', message.payload, message);
  }

  private handleEventMessage(message: PortalMessage): void {
    this.emit('eventReceived', message.payload, message);
  }

  private handlePingMessage(message: PortalMessage): void {
    const pong = this.sendPong(message.id);
    this.emit('pingReceived', message, pong);
  }

  private handlePongMessage(message: PortalMessage): void {
    const { pingId } = message.payload;
    if (this.acknowledgementMap.has(pingId)) {
      const sentTime = this.acknowledgementMap.get(pingId)!;
      const latency = Date.now() - sentTime;
      this.acknowledgementMap.delete(pingId);
      this.emit('pongReceived', message, latency);
    }
  }

  private handleErrorMessage(message: PortalMessage): void {
    this.emit('errorReceived', message.payload, message);
  }

  private startRetryTimer(): void {
    const checkRetries = () => {
      const now = Date.now();
      
      for (const [messageId, retryInfo] of this.retryMap.entries()) {
        if (now >= retryInfo.nextRetry) {
          if (retryInfo.attempts >= this.maxRetries) {
            // Max retries exceeded
            this.markMessageFailed(messageId, new Error('Max retries exceeded'));
            this.retryMap.delete(messageId);
          } else {
            // Schedule retry
            retryInfo.attempts++;
            retryInfo.nextRetry = now + (this.retryDelayMs * Math.pow(2, retryInfo.attempts));
            this.emit('messageRetry', retryInfo.message, retryInfo.attempts);
          }
        }
      }
    };
    
    setInterval(checkRetries, 1000); // Check every second
  }

  private generateMessageId(): string {
    return `msg_${this.sessionId}_${Date.now()}_${++this.messageIdCounter}`;
  }

  private compressData(data: string): string {
    // Placeholder for compression implementation
    // In real implementation, use a compression library like pako
    return data;
  }

  private decompressData(data: string): string {
    // Placeholder for decompression implementation
    return data;
  }

  private encryptData(data: string): string {
    // Placeholder for encryption implementation
    // In real implementation, use crypto library
    return data;
  }

  private decryptData(data: string): string {
    // Placeholder for decryption implementation
    return data;
  }
}

export interface StreamProtocolOptions {
  bufferSize?: number;
  enableCompression?: boolean;
  enableEncryption?: boolean;
}

export interface StreamProtocolStats {
  sessionId: string;
  messagesBuffered: number;
  messagesAwaitingAck: number;
  compressionEnabled: boolean;
  encryptionEnabled: boolean;
  bufferUtilization: number;
}