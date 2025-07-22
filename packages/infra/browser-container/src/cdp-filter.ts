/**
 * CDP Command Filter and Security Layer
 * Validates and filters Chrome DevTools Protocol commands for security
 */

export interface CDPCommand {
  method: string;
  params?: any;
  id?: number;
}

export interface CDPFilterConfig {
  mode: 'allowlist' | 'blocklist';
  rules: CDPRule[];
  enableLogging?: boolean;
  rateLimits?: RateLimitConfig;
}

export interface CDPRule {
  method: string | RegExp;
  params?: ParamFilter;
  reason?: string;
}

export interface ParamFilter {
  [key: string]: any | ParamFilter;
}

export interface RateLimitConfig {
  windowMs: number;
  maxCommands: number;
  perMethod?: { [method: string]: number };
}

export class CDPSecurityFilter {
  private readonly config: CDPFilterConfig;
  private readonly commandCounts: Map<string, number[]> = new Map();
  private readonly methodCounts: Map<string, Map<string, number[]>> = new Map();

  // Default safe CDP methods for Stagehand functionality
  private static readonly STAGEHAND_SAFE_METHODS = [
    // Page navigation and lifecycle
    'Page.navigate',
    'Page.reload',
    'Page.stopLoading',
    'Page.getFrameTree',
    'Page.createIsolatedWorld',

    // DOM inspection (read-only)
    'DOM.getDocument',
    'DOM.querySelector',
    'DOM.querySelectorAll',
    'DOM.getNodeForLocation',
    'DOM.getBoxModel',
    'DOM.getOuterHTML',
    'DOM.resolveNode',
    'DOM.describeNode',
    'DOM.getAttributes',

    // Accessibility tree (critical for Stagehand)
    'Accessibility.getFullAXTree',
    'Accessibility.getPartialAXTree',
    'Accessibility.queryAXTree',

    // Runtime evaluation (with restrictions)
    'Runtime.evaluate',
    'Runtime.callFunctionOn',
    'Runtime.getProperties',
    'Runtime.releaseObject',
    'Runtime.releaseObjectGroup',

    // Input simulation
    'Input.dispatchKeyEvent',
    'Input.dispatchMouseEvent',
    'Input.dispatchTouchEvent',
    'Input.insertText',
    'Input.setIgnoreInputEvents',

    // Screencasting (for visual feedback)
    'Page.startScreencast',
    'Page.stopScreencast',
    'Page.screencastFrameAck',
    'Page.captureScreenshot',

    // Network monitoring (read-only)
    'Network.enable',
    'Network.disable',
    'Network.getResponseBody',

    // Console monitoring
    'Console.enable',
    'Console.disable',

    // Performance metrics
    'Performance.getMetrics',

    // Emulation
    'Emulation.setDeviceMetricsOverride',
    'Emulation.setUserAgentOverride',
    'Emulation.setGeolocationOverride',
    'Emulation.setTimezoneOverride',
    'Emulation.setLocaleOverride',

    // Target management
    'Target.getTargets',
    'Target.getTargetInfo',
    'Target.attachToTarget',
    'Target.detachFromTarget',
  ];

  // Dangerous methods that should always be blocked
  private static readonly DANGEROUS_METHODS = [
    // File system access
    'FileSystem.*',
    'IO.*',

    // Process control
    'Browser.close',
    'Browser.crash',
    'Target.closeTarget',

    // Security bypasses
    'Security.disable',
    'Security.setIgnoreCertificateErrors',
    'Security.handleCertificateError',

    // Memory access
    'Memory.*',
    'HeapProfiler.*',
    'Profiler.*',

    // Debugging controls
    'Debugger.*',

    // Service worker manipulation
    'ServiceWorker.*',
    'BackgroundService.*',

    // Storage manipulation (if not needed)
    'Storage.clear*',
    'IndexedDB.*',

    // Tracing (can expose sensitive data)
    'Tracing.*',

    // System info
    'SystemInfo.*',
  ];

  constructor(config?: Partial<CDPFilterConfig>) {
    this.config = {
      mode: 'allowlist',
      rules: this.createDefaultRules(),
      enableLogging: true,
      rateLimits: {
        windowMs: 60000, // 1 minute
        maxCommands: 1000, // 1000 commands per minute
        perMethod: {
          'Page.captureScreenshot': 60, // 1 per second
          'Runtime.evaluate': 100, // Limit eval calls
        },
      },
      ...config,
    };
  }

  private createDefaultRules(): CDPRule[] {
    const rules: CDPRule[] = [];

    // Add safe methods
    for (const method of CDPSecurityFilter.STAGEHAND_SAFE_METHODS) {
      rules.push({
        method,
        reason: 'Required for Stagehand automation',
      });
    }

    // Add restricted Runtime.evaluate
    rules.push({
      method: 'Runtime.evaluate',
      params: {
        // Block evaluations that try to access dangerous APIs
        expression: (expr: string) => {
          const dangerous = [
            'require(',
            'process.',
            'child_process',
            'fs.',
            '__dirname',
            '__filename',
            'eval(',
            'Function(',
            'WebAssembly',
            '.constructor(',
            'importScripts',
          ];

          const lowerExpr = expr.toLowerCase();
          return !dangerous.some((pattern) => lowerExpr.includes(pattern.toLowerCase()));
        },
      },
      reason: 'Evaluate with restrictions',
    });

    return rules;
  }

  /**
   * Filter a CDP command
   */
  async filterCommand(command: CDPCommand, sessionId: string): Promise<FilterResult> {
    // Check rate limits first
    const rateLimitResult = this.checkRateLimit(command, sessionId);
    if (!rateLimitResult.allowed) {
      return rateLimitResult;
    }

    // Check against rules
    const isAllowed = this.config.mode === 'allowlist' ? this.isInAllowlist(command) : !this.isInBlocklist(command);

    if (!isAllowed) {
      if (this.config.enableLogging) {
        console.warn(`[CDP Filter] Blocked command: ${command.method} for session ${sessionId}`);
      }

      return {
        allowed: false,
        reason: `Method ${command.method} is not allowed`,
        sanitizedCommand: null,
      };
    }

    // Apply parameter filtering
    const sanitizedCommand = this.sanitizeCommand(command);

    if (this.config.enableLogging && sanitizedCommand !== command) {
      console.info(`[CDP Filter] Sanitized command: ${command.method} for session ${sessionId}`);
    }

    return {
      allowed: true,
      reason: null,
      sanitizedCommand,
    };
  }

  private checkRateLimit(command: CDPCommand, sessionId: string): FilterResult {
    if (!this.config.rateLimits) {
      return { allowed: true, reason: null, sanitizedCommand: command };
    }

    const now = Date.now();
    const { windowMs, maxCommands, perMethod } = this.config.rateLimits;

    // Check global rate limit
    const globalCounts = this.commandCounts.get(sessionId) || [];
    const recentGlobal = globalCounts.filter((time) => now - time < windowMs);

    if (recentGlobal.length >= maxCommands) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${maxCommands} commands per ${windowMs}ms`,
        sanitizedCommand: null,
      };
    }

    // Check per-method rate limit
    if (perMethod && perMethod[command.method]) {
      const methodLimit = perMethod[command.method];
      const methodMap = this.methodCounts.get(sessionId) || new Map();
      const methodCounts = methodMap.get(command.method) || [];
      const recentMethod = methodCounts.filter((time: number) => now - time < windowMs);

      if (recentMethod.length >= methodLimit) {
        return {
          allowed: false,
          reason: `Rate limit exceeded for ${command.method}: ${methodLimit} calls per ${windowMs}ms`,
          sanitizedCommand: null,
        };
      }

      // Update method counts
      methodCounts.push(now);
      methodMap.set(command.method, methodCounts.slice(-methodLimit));
      this.methodCounts.set(sessionId, methodMap);
    }

    // Update global counts
    globalCounts.push(now);
    this.commandCounts.set(sessionId, globalCounts.slice(-maxCommands));

    return { allowed: true, reason: null, sanitizedCommand: command };
  }

  private isInAllowlist(command: CDPCommand): boolean {
    return this.config.rules.some((rule) => {
      if (!this.matchesMethod(command.method, rule.method)) {
        return false;
      }

      if (rule.params && command.params) {
        return this.matchesParams(command.params, rule.params);
      }

      return true;
    });
  }

  private isInBlocklist(command: CDPCommand): boolean {
    // Check dangerous methods first
    const isDangerous = CDPSecurityFilter.DANGEROUS_METHODS.some((pattern) => {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return regex.test(command.method);
    });

    if (isDangerous) {
      return true;
    }

    return this.config.rules.some((rule) => {
      if (!this.matchesMethod(command.method, rule.method)) {
        return false;
      }

      if (rule.params && command.params) {
        return !this.matchesParams(command.params, rule.params);
      }

      return true;
    });
  }

  private matchesMethod(method: string, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return method === pattern || (pattern.includes('*') && new RegExp(pattern.replace('*', '.*')).test(method));
    }
    return pattern.test(method);
  }

  private matchesParams(params: any, filter: ParamFilter): boolean {
    for (const [key, filterValue] of Object.entries(filter)) {
      if (!(key in params)) {
        return false;
      }

      if (typeof filterValue === 'function') {
        if (!filterValue(params[key])) {
          return false;
        }
      } else if (typeof filterValue === 'object' && filterValue !== null) {
        if (!this.matchesParams(params[key], filterValue)) {
          return false;
        }
      } else if (params[key] !== filterValue) {
        return false;
      }
    }

    return true;
  }

  private sanitizeCommand(command: CDPCommand): CDPCommand {
    // Special handling for Runtime.evaluate
    if (command.method === 'Runtime.evaluate' && command.params?.expression) {
      const sanitized = this.sanitizeExpression(command.params.expression);
      if (sanitized !== command.params.expression) {
        return {
          ...command,
          params: {
            ...command.params,
            expression: sanitized,
          },
        };
      }
    }

    // Remove sensitive parameters
    if (command.method === 'Network.setCookie' && command.params?.cookie) {
      return {
        ...command,
        params: {
          ...command.params,
          cookie: {
            ...command.params.cookie,
            // Remove httpOnly cookies
            httpOnly: false,
          },
        },
      };
    }

    return command;
  }

  private sanitizeExpression(expression: string): string {
    // Remove potentially dangerous patterns
    let sanitized = expression;

    // Remove attempts to access Node.js globals
    sanitized = sanitized.replace(/process\.\w+/g, 'undefined');
    sanitized = sanitized.replace(/require\s*\(/g, 'undefined(');
    sanitized = sanitized.replace(/__dirname/g, '""');
    sanitized = sanitized.replace(/__filename/g, '""');

    // Prevent constructor access hacks
    sanitized = sanitized.replace(/\.constructor\s*\(/g, '.undefined(');

    return sanitized;
  }

  /**
   * Clean up rate limit data for a session
   */
  cleanupSession(sessionId: string): void {
    this.commandCounts.delete(sessionId);
    this.methodCounts.delete(sessionId);
  }
}

export interface FilterResult {
  allowed: boolean;
  reason: string | null;
  sanitizedCommand: CDPCommand | null;
}

/**
 * Create a CDP filter for Stagehand use case
 */
export function createStagehandCDPFilter(): CDPSecurityFilter {
  return new CDPSecurityFilter({
    mode: 'allowlist',
    enableLogging: true,
    rateLimits: {
      windowMs: 60000,
      maxCommands: 2000, // Higher limit for automation
      perMethod: {
        'Page.captureScreenshot': 120, // 2 per second for screencasting
        'Page.startScreencast': 10, // 10 starts per minute (reasonable for toggle)
        'Page.stopScreencast': 10, // 10 stops per minute
        'Page.screencastFrameAck': 1000, // High limit for frame acknowledgments
        'Runtime.evaluate': 500, // More evals for automation
        'Input.dispatchMouseEvent': 1000, // Many mouse events
        'Input.dispatchKeyEvent': 1000, // Many key events
      },
    },
  });
}
