/**
 * Base event publishing utility for real-time communication
 * Provides common functionality for event publishing and subscription
 */

import {
  AutomationEvent,
  EventCallback,
  IEventPublisher
} from '../types/events';

/**
 * Configuration for event publisher
 */
export interface EventPublisherConfig {
  /** Event retention time in seconds */
  eventRetention?: number;
  /** Maximum subscribers per session */
  maxSubscribers?: number;
  /** Enable event logging */
  enableLogging?: boolean;
}

/**
 * Subscription information
 */
export interface Subscription {
  /** Subscription ID */
  id: string;
  /** Session ID this subscription belongs to */
  sessionId: string;
  /** Callback function */
  callback: EventCallback;
  /** Subscription timestamp */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
}

/**
 * Base event publisher implementation for in-memory event handling
 * Can be extended by Redis or other backends
 */
export class BaseEventPublisher implements IEventPublisher {
  protected readonly config: Required<EventPublisherConfig>;
  protected readonly subscriptions = new Map<string, Subscription>();
  protected readonly sessionSubscriptions = new Map<string, Set<string>>();
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: EventPublisherConfig = {}) {
    this.config = {
      eventRetention: config.eventRetention ?? 3600, // 1 hour
      maxSubscribers: config.maxSubscribers ?? 100,
      enableLogging: config.enableLogging ?? true,
    };

    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Publish an event to a specific session
   */
  async publishEvent(sessionId: string, event: AutomationEvent): Promise<void> {
    const subscribers = this.sessionSubscriptions.get(sessionId);
    
    if (!subscribers || subscribers.size === 0) {
      if (this.config.enableLogging) {
        console.log(`[EventPublisher] No subscribers for session ${sessionId}`);
      }
      return;
    }

    if (this.config.enableLogging) {
      console.log(
        `[EventPublisher] Publishing event ${event.type} to ${subscribers.size} subscribers for session ${sessionId}`
      );
    }

    // Publish to all subscribers
    const publishPromises = Array.from(subscribers).map(async (subscriptionId) => {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        try {
          await subscription.callback(event);
          // Update last activity
          subscription.lastActivity = new Date();
        } catch (error) {
          console.error(
            `[EventPublisher] Error in subscription ${subscriptionId}:`,
            error
          );
          // Remove failed subscription
          this.removeSubscription(subscriptionId);
        }
      }
    });

    await Promise.allSettled(publishPromises);
  }

  /**
   * Subscribe to events for a session
   */
  async subscribe(sessionId: string, callback: EventCallback): Promise<string> {
    // Check max subscribers limit
    const currentSubscribers = this.sessionSubscriptions.get(sessionId)?.size ?? 0;
    if (currentSubscribers >= this.config.maxSubscribers) {
      throw new Error(`Maximum subscribers (${this.config.maxSubscribers}) reached for session ${sessionId}`);
    }

    const subscriptionId = this.generateSubscriptionId();
    
    const subscription: Subscription = {
      id: subscriptionId,
      sessionId,
      callback,
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Add to session subscriptions
    if (!this.sessionSubscriptions.has(sessionId)) {
      this.sessionSubscriptions.set(sessionId, new Set());
    }
    this.sessionSubscriptions.get(sessionId)!.add(subscriptionId);

    if (this.config.enableLogging) {
      console.log(
        `[EventPublisher] Added subscription ${subscriptionId} for session ${sessionId}`
      );
    }

    return subscriptionId;
  }

  /**
   * Unsubscribe from events
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    this.removeSubscription(subscriptionId);
  }

  /**
   * Clean up expired subscriptions
   */
  async cleanup(): Promise<void> {
    const now = new Date();
    const expiredSubscriptions: string[] = [];

    for (const [subscriptionId, subscription] of this.subscriptions) {
      const timeSinceActivity = now.getTime() - subscription.lastActivity.getTime();
      if (timeSinceActivity > this.config.eventRetention * 1000) {
        expiredSubscriptions.push(subscriptionId);
      }
    }

    for (const subscriptionId of expiredSubscriptions) {
      this.removeSubscription(subscriptionId);
    }

    if (expiredSubscriptions.length > 0 && this.config.enableLogging) {
      console.log(`[EventPublisher] Cleaned up ${expiredSubscriptions.length} expired subscriptions`);
    }
  }

  /**
   * Get subscription information
   */
  getSubscription(subscriptionId: string): Subscription | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  /**
   * Get all subscriptions for a session
   */
  getSessionSubscriptions(sessionId: string): Subscription[] {
    const subscriptionIds = this.sessionSubscriptions.get(sessionId);
    if (!subscriptionIds) {
      return [];
    }

    return Array.from(subscriptionIds)
      .map(id => this.subscriptions.get(id))
      .filter((sub): sub is Subscription => sub !== undefined);
  }

  /**
   * Get event publisher statistics
   * Provides subscription and event-related metrics
   */
  getStats(): {
    totalSubscriptions: number;
    activeSessions: number;
    oldestSubscription?: Date;
  } {
    const subscriptions = Array.from(this.subscriptions.values());
    
    return {
      totalSubscriptions: subscriptions.length,
      activeSessions: this.sessionSubscriptions.size,
      oldestSubscription: subscriptions.length > 0 
        ? new Date(Math.min(...subscriptions.map(s => s.createdAt.getTime())))
        : undefined,
    };
  }

  /**
   * Remove a subscription
   */
  protected removeSubscription(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }

    // Remove from subscriptions
    this.subscriptions.delete(subscriptionId);

    // Remove from session subscriptions
    const sessionSubscriptions = this.sessionSubscriptions.get(subscription.sessionId);
    if (sessionSubscriptions) {
      sessionSubscriptions.delete(subscriptionId);
      
      // Clean up empty session subscription sets
      if (sessionSubscriptions.size === 0) {
        this.sessionSubscriptions.delete(subscription.sessionId);
      }
    }

    if (this.config.enableLogging) {
      console.log(`[EventPublisher] Removed subscription ${subscriptionId}`);
    }
  }

  /**
   * Generate a unique subscription ID
   */
  private generateSubscriptionId(): string {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Start automatic cleanup
   */
  private startCleanup(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch(error => {
        console.error('[EventPublisher] Cleanup error:', error);
      });
    }, 60 * 60 * 1000);
  }

  /**
   * Stop automatic cleanup
   */
  protected stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Destroy the event publisher
   */
  destroy(): void {
    this.stopCleanup();
    this.subscriptions.clear();
    this.sessionSubscriptions.clear();
  }
}