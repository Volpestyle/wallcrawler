import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import { 
  PortalCommand, 
  PortalCommandType,
  PortalBrowserState,
  AutomationStatus 
} from 'wallcrawler/types/portal';

// Command validation schemas
const ExecuteActionCommandSchema = z.object({
  type: z.literal('execute-action'),
  action: z.string(),
  selector: z.string().optional(),
  value: z.any().optional(),
  options: z.record(z.any()).optional()
});

const InjectScriptCommandSchema = z.object({
  type: z.literal('inject-script'),
  script: z.string(),
  args: z.array(z.any()).optional()
});

const NavigateCommandSchema = z.object({
  type: z.literal('navigate'),
  url: z.string().url()
});

/**
 * Command Handler
 * 
 * Processes and validates commands from the portal UI and translates them
 * into automation actions. Provides command validation, rate limiting,
 * and permission checking.
 */
export class CommandHandler extends EventEmitter {
  private currentState: PortalBrowserState | null = null;
  private commandQueue: PortalCommand[] = [];
  private isProcessing = false;
  private rateLimitMap = new Map<PortalCommandType, number[]>();
  private permissions: Set<PortalCommandType> = new Set();

  // Rate limits per command type (requests per minute)
  private readonly rateLimits: Record<PortalCommandType, number> = {
    'pause': 10,
    'resume': 10,
    'stop': 5,
    'take-control': 3,
    'return-control': 3,
    'execute-action': 60,
    'inject-script': 10,
    'screenshot': 20,
    'reload': 5,
    'navigate': 10,
    'close-portal': 5
  };

  constructor(permissions?: PortalCommandType[]) {
    super();
    this.setPermissions(permissions || this.getDefaultPermissions());
  }

  /**
   * Set allowed command types
   */
  setPermissions(permissions: PortalCommandType[]): void {
    this.permissions.clear();
    permissions.forEach(perm => this.permissions.add(perm));
    this.emit('permissionsUpdated', Array.from(this.permissions));
  }

  /**
   * Get current permissions
   */
  getPermissions(): PortalCommandType[] {
    return Array.from(this.permissions);
  }

  /**
   * Update current browser state
   */
  updateState(state: PortalBrowserState): void {
    this.currentState = state;
    this.emit('stateUpdated', state);
  }

  /**
   * Process a command from the portal
   */
  async processCommand(command: PortalCommand): Promise<void> {
    try {
      // Validate command structure
      this.validateCommand(command);
      
      // Check permissions
      if (!this.hasPermission(command.type)) {
        throw new Error(`Permission denied for command: ${command.type}`);
      }
      
      // Check rate limits
      this.checkRateLimit(command.type);
      
      // Validate command-specific payload
      this.validateCommandPayload(command);
      
      // Add to queue and process
      this.commandQueue.push(command);
      await this.processQueue();
      
    } catch (error) {
      this.emit('commandError', command, error);
      throw error;
    }
  }

  /**
   * Create a standardized command
   */
  createCommand(type: PortalCommandType, payload?: Record<string, any>): PortalCommand {
    return {
      id: this.generateCommandId(),
      type,
      timestamp: Date.now(),
      payload: payload || {}
    };
  }

  /**
   * Get command queue status
   */
  getQueueStatus(): { pending: number; processing: boolean } {
    return {
      pending: this.commandQueue.length,
      processing: this.isProcessing
    };
  }

  /**
   * Clear command queue
   */
  clearQueue(): void {
    this.commandQueue = [];
    this.emit('queueCleared');
  }

  /**
   * Get rate limit status for a command type
   */
  getRateLimitStatus(type: PortalCommandType): { remaining: number; resetTime: number } {
    const now = Date.now();
    const oneMinute = 60 * 1000;
    const timestamps = this.rateLimitMap.get(type) || [];
    
    // Filter out old timestamps
    const recentTimestamps = timestamps.filter(ts => now - ts < oneMinute);
    
    const limit = this.rateLimits[type];
    const remaining = Math.max(0, limit - recentTimestamps.length);
    const oldestTimestamp = recentTimestamps[0] || now;
    const resetTime = oldestTimestamp + oneMinute;
    
    return { remaining, resetTime };
  }

  private validateCommand(command: PortalCommand): void {
    if (!command.id || typeof command.id !== 'string') {
      throw new Error('Command must have a valid ID');
    }
    
    if (!command.type || typeof command.type !== 'string') {
      throw new Error('Command must have a valid type');
    }
    
    if (!command.timestamp || typeof command.timestamp !== 'number') {
      throw new Error('Command must have a valid timestamp');
    }
    
    // Check if command is too old (prevent replay attacks)
    const maxAge = 5 * 60 * 1000; // 5 minutes
    if (Date.now() - command.timestamp > maxAge) {
      throw new Error('Command is too old');
    }
  }

  private validateCommandPayload(command: PortalCommand): void {
    switch (command.type) {
      case 'execute-action':
        ExecuteActionCommandSchema.parse(command.payload);
        break;
        
      case 'inject-script':
        InjectScriptCommandSchema.parse(command.payload);
        break;
        
      case 'navigate':
        NavigateCommandSchema.parse(command.payload);
        break;
        
      // Other commands don't require special payload validation
      default:
        break;
    }
  }

  private hasPermission(type: PortalCommandType): boolean {
    return this.permissions.has(type);
  }

  private checkRateLimit(type: PortalCommandType): void {
    const now = Date.now();
    const oneMinute = 60 * 1000;
    
    if (!this.rateLimitMap.has(type)) {
      this.rateLimitMap.set(type, []);
    }
    
    const timestamps = this.rateLimitMap.get(type)!;
    
    // Remove old timestamps
    const recentTimestamps = timestamps.filter(ts => now - ts < oneMinute);
    this.rateLimitMap.set(type, recentTimestamps);
    
    // Check if limit exceeded
    const limit = this.rateLimits[type];
    if (recentTimestamps.length >= limit) {
      throw new Error(`Rate limit exceeded for command: ${type}. Limit: ${limit}/minute`);
    }
    
    // Add current timestamp
    recentTimestamps.push(now);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.commandQueue.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    this.emit('queueProcessingStarted');
    
    try {
      while (this.commandQueue.length > 0) {
        const command = this.commandQueue.shift()!;
        await this.executeCommand(command);
      }
    } finally {
      this.isProcessing = false;
      this.emit('queueProcessingCompleted');
    }
  }

  private async executeCommand(command: PortalCommand): Promise<void> {
    this.emit('commandExecuting', command);
    
    try {
      switch (command.type) {
        case 'pause':
          await this.executePauseCommand(command);
          break;
          
        case 'resume':
          await this.executeResumeCommand(command);
          break;
          
        case 'stop':
          await this.executeStopCommand(command);
          break;
          
        case 'take-control':
          await this.executeTakeControlCommand(command);
          break;
          
        case 'return-control':
          await this.executeReturnControlCommand(command);
          break;
          
        case 'execute-action':
          await this.executeActionCommand(command);
          break;
          
        case 'inject-script':
          await this.executeInjectScriptCommand(command);
          break;
          
        case 'screenshot':
          await this.executeScreenshotCommand(command);
          break;
          
        case 'reload':
          await this.executeReloadCommand(command);
          break;
          
        case 'navigate':
          await this.executeNavigateCommand(command);
          break;
          
        case 'close-portal':
          await this.executeClosePortalCommand(command);
          break;
          
        default:
          throw new Error(`Unknown command type: ${command.type}`);
      }
      
      this.emit('commandCompleted', command);
      
    } catch (error) {
      this.emit('commandFailed', command, error);
      throw error;
    }
  }

  private async executePauseCommand(command: PortalCommand): Promise<void> {
    this.emit('automationPauseRequested', command);
  }

  private async executeResumeCommand(command: PortalCommand): Promise<void> {
    this.emit('automationResumeRequested', command);
  }

  private async executeStopCommand(command: PortalCommand): Promise<void> {
    this.emit('automationStopRequested', command);
  }

  private async executeTakeControlCommand(command: PortalCommand): Promise<void> {
    this.emit('manualControlRequested', command);
  }

  private async executeReturnControlCommand(command: PortalCommand): Promise<void> {
    this.emit('automationControlReturned', command);
  }

  private async executeActionCommand(command: PortalCommand): Promise<void> {
    const { action, selector, value, options } = command.payload!;
    this.emit('actionRequested', {
      command,
      action,
      selector,
      value,
      options
    });
  }

  private async executeInjectScriptCommand(command: PortalCommand): Promise<void> {
    const { script, args } = command.payload!;
    this.emit('scriptInjectionRequested', {
      command,
      script,
      args: args || []
    });
  }

  private async executeScreenshotCommand(command: PortalCommand): Promise<void> {
    this.emit('screenshotRequested', command);
  }

  private async executeReloadCommand(command: PortalCommand): Promise<void> {
    this.emit('pageReloadRequested', command);
  }

  private async executeNavigateCommand(command: PortalCommand): Promise<void> {
    const { url } = command.payload!;
    this.emit('navigationRequested', {
      command,
      url
    });
  }

  private async executeClosePortalCommand(command: PortalCommand): Promise<void> {
    this.emit('portalCloseRequested', command);
  }

  private generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDefaultPermissions(): PortalCommandType[] {
    return [
      'pause',
      'resume',
      'take-control',
      'return-control',
      'execute-action',
      'screenshot',
      'reload',
      'close-portal'
    ];
  }
}