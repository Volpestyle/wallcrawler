/**
 * WallCrawler Portal Embed SDK
 * JavaScript SDK for embedding portal widgets in web and mobile apps
 */
class PortalEmbedSDK {
  constructor(config = {}) {
    this.config = {
      apiBaseUrl: config.apiBaseUrl || '/api/portal',
      widgetBaseUrl: config.widgetBaseUrl || '/portal/widget',
      theme: config.theme || 'dark',
      ...config
    };
    
    this.widgets = new Map();
  }
  
  /**
   * Create an embedded portal widget
   */
  createWidget(container, sessionId, options = {}) {
    const widgetId = `portal-widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const widget = new PortalEmbeddedWidget({
      widgetId,
      container,
      sessionId,
      sdk: this,
      ...options
    });
    
    this.widgets.set(widgetId, widget);
    return widget;
  }
  
  /**
   * Create portal controls without the browser view
   */
  createControls(container, sessionId, options = {}) {
    const controlsId = `portal-controls-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const controls = new PortalEmbeddedControls({
      controlsId,
      container,
      sessionId,
      sdk: this,
      ...options
    });
    
    this.widgets.set(controlsId, controls);
    return controls;
  }
  
  /**
   * Create browser view without controls
   */
  createBrowserView(container, sessionId, options = {}) {
    const viewId = `portal-view-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const view = new PortalEmbeddedBrowserView({
      viewId,
      container,
      sessionId,
      sdk: this,
      ...options
    });
    
    this.widgets.set(viewId, view);
    return view;
  }
  
  /**
   * Get widget by ID
   */
  getWidget(widgetId) {
    return this.widgets.get(widgetId);
  }
  
  /**
   * Remove widget
   */
  removeWidget(widgetId) {
    const widget = this.widgets.get(widgetId);
    if (widget && typeof widget.unmount === 'function') {
      widget.unmount();
    }
    this.widgets.delete(widgetId);
  }
  
  /**
   * Clean up all widgets
   */
  cleanup() {
    for (const [widgetId, widget] of this.widgets) {
      if (typeof widget.unmount === 'function') {
        widget.unmount();
      }
    }
    this.widgets.clear();
  }
}

/**
 * Portal Widget Implementation
 */
class PortalEmbeddedWidget extends EventTarget {
  constructor(options) {
    super();
    
    this.widgetId = options.widgetId;
    this.container = options.container;
    this.sessionId = options.sessionId;
    this.sdk = options.sdk;
    this.options = options;
    
    this.iframe = null;
    this.isConnected = false;
    this.sessionInfo = null;
  }
  
  async mount() {
    try {
      // Create iframe for the widget
      this.iframe = document.createElement('iframe');
      this.iframe.id = this.widgetId;
      this.iframe.style.width = this.options.width || '100%';
      this.iframe.style.height = this.options.height || '400px';
      this.iframe.style.border = 'none';
      this.iframe.style.borderRadius = '8px';
      this.iframe.allow = 'fullscreen';
      
      // Build widget URL
      const widgetUrl = new URL(`${this.sdk.config.widgetBaseUrl}/widget.html`, window.location.origin);
      widgetUrl.searchParams.set('sessionId', this.sessionId);
      widgetUrl.searchParams.set('apiBaseUrl', this.sdk.config.apiBaseUrl);
      widgetUrl.searchParams.set('theme', this.options.theme || this.sdk.config.theme);
      
      if (this.options.showControls !== undefined) {
        widgetUrl.searchParams.set('showControls', this.options.showControls.toString());
      }
      
      this.iframe.src = widgetUrl.toString();
      
      // Set up message handling
      window.addEventListener('message', this.handleIframeMessage.bind(this));
      
      // Append to container
      this.container.appendChild(this.iframe);
      
      // Wait for widget to load
      await this.waitForLoad();
      
      this.dispatchEvent(new CustomEvent('mounted'));
      
    } catch (error) {
      console.error('Failed to mount portal widget:', error);
      throw error;
    }
  }
  
  unmount() {
    if (this.iframe && this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
    this.iframe = null;
    this.isConnected = false;
    this.dispatchEvent(new CustomEvent('unmounted'));
  }
  
  resize(width, height) {
    if (this.iframe) {
      if (width) this.iframe.style.width = typeof width === 'number' ? `${width}px` : width;
      if (height) this.iframe.style.height = typeof height === 'number' ? `${height}px` : height;
      
      // Notify iframe of resize
      this.postMessage({ type: 'portal-resize', width, height });
    }
  }
  
  isConnected() {
    return this.isConnected;
  }
  
  getSessionInfo() {
    return this.sessionInfo;
  }
  
  async pause() {
    this.postMessage({ type: 'portal-command', command: { type: 'pause-automation', sessionId: this.sessionId } });
  }
  
  async resume() {
    this.postMessage({ type: 'portal-command', command: { type: 'resume-automation', sessionId: this.sessionId } });
  }
  
  async takeControl() {
    this.postMessage({ type: 'portal-command', command: { type: 'take-control', sessionId: this.sessionId } });
  }
  
  async returnControl() {
    this.postMessage({ type: 'portal-command', command: { type: 'return-control', sessionId: this.sessionId } });
  }
  
  async takeScreenshot() {
    this.postMessage({ type: 'portal-command', command: { type: 'take-screenshot', sessionId: this.sessionId } });
  }
  
  on(event, handler) {
    this.addEventListener(event, handler);
  }
  
  off(event, handler) {
    this.removeEventListener(event, handler);
  }
  
  private postMessage(message) {
    if (this.iframe && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage(message, '*');
    }
  }
  
  private handleIframeMessage(event) {
    if (event.source !== this.iframe?.contentWindow) {
      return;
    }
    
    const { type, data } = event.data;
    
    switch (type) {
      case 'portal-loaded':
        this.isConnected = true;
        this.dispatchEvent(new CustomEvent('connected'));
        break;
      case 'portal-session-info':
        this.sessionInfo = data;
        this.dispatchEvent(new CustomEvent('sessionUpdated', { detail: data }));
        break;
      case 'portal-state-updated':
        this.dispatchEvent(new CustomEvent('stateUpdated', { detail: data }));
        break;
      case 'portal-command-response':
        this.dispatchEvent(new CustomEvent('commandResponse', { detail: data }));
        break;
      case 'portal-error':
        this.dispatchEvent(new CustomEvent('error', { detail: data }));
        break;
    }
  }
  
  private async waitForLoad() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Widget load timeout'));
      }, 10000);
      
      const handleLoad = () => {
        clearTimeout(timeout);
        resolve();
      };
      
      if (this.iframe.complete) {
        handleLoad();
      } else {
        this.iframe.addEventListener('load', handleLoad, { once: true });
      }
    });
  }
}

/**
 * Portal Controls Implementation
 */
class PortalEmbeddedControls extends EventTarget {
  constructor(options) {
    super();
    
    this.controlsId = options.controlsId;
    this.container = options.container;
    this.sessionId = options.sessionId;
    this.sdk = options.sdk;
    this.options = options;
    
    this.element = null;
    this.sessionInfo = null;
  }
  
  async mount() {
    // Create controls HTML
    this.element = document.createElement('div');
    this.element.id = this.controlsId;
    this.element.className = 'portal-controls';
    this.element.innerHTML = this.getControlsHTML();
    
    // Apply theme
    this.setTheme(this.options.theme || this.sdk.config.theme);
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Append to container
    this.container.appendChild(this.element);
    
    // Fetch initial session info
    await this.fetchSessionInfo();
    
    this.dispatchEvent(new CustomEvent('mounted'));
  }
  
  unmount() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.dispatchEvent(new CustomEvent('unmounted'));
  }
  
  setTheme(theme) {
    if (this.element) {
      this.element.className = `portal-controls theme-${theme}`;
    }
  }
  
  updateSessionInfo(info) {
    this.sessionInfo = info;
    this.updateUI();
  }
  
  on(event, handler) {
    this.addEventListener(event, handler);
  }
  
  off(event, handler) {
    this.removeEventListener(event, handler);
  }
  
  private getControlsHTML() {
    return `
      <div class="controls-header">
        <span class="session-id">Session: ${this.sessionId}</span>
        <span class="status-indicator"></span>
      </div>
      <div class="controls-buttons">
        <button class="control-btn" data-action="pause">Pause</button>
        <button class="control-btn" data-action="resume">Resume</button>
        <button class="control-btn" data-action="takeControl">Take Control</button>
        <button class="control-btn" data-action="screenshot">Screenshot</button>
        <button class="control-btn danger" data-action="close">Close</button>
      </div>
      <style>
        .portal-controls {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: #1a1a3a;
          border: 1px solid #333;
          border-radius: 8px;
          padding: 12px;
          color: #ccc;
        }
        .controls-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          font-size: 12px;
        }
        .controls-buttons {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .control-btn {
          background: #3373dc;
          border: none;
          color: white;
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 11px;
          cursor: pointer;
          transition: background 0.2s;
        }
        .control-btn:hover {
          background: #4d86f7;
        }
        .control-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .control-btn.danger {
          background: #dc3545;
        }
        .control-btn.danger:hover {
          background: #e55464;
        }
        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #f44336;
        }
        .status-indicator.connected {
          background: #4caf50;
        }
      </style>
    `;
  }
  
  private setupEventListeners() {
    this.element.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (button) {
        const action = button.dataset.action;
        this.handleAction(action);
        this.dispatchEvent(new CustomEvent(`${action}Clicked`));
      }
    });
  }
  
  private async handleAction(action) {
    switch (action) {
      case 'pause':
        this.sendControlMessage('pause-automation');
        break;
      case 'resume':
        this.sendControlMessage('resume-automation');
        break;
      case 'takeControl':
        this.sendControlMessage('take-control');
        break;
      case 'returnControl':
        this.sendControlMessage('return-control');
        break;
      case 'screenshot':
        this.sendControlMessage('take-screenshot');
        break;
      case 'close':
        this.dispatchEvent(new CustomEvent('closeClicked'));
        return;
    }
  }
  
  private sendControlMessage(commandType) {
    // Send message to parent widget iframe
    const message = {
      type: 'portal-command',
      command: {
        type: commandType,
        sessionId: this.sessionId,
        timestamp: Date.now()
      }
    };
    
    // If this is embedded in an iframe, we need to communicate through the widget
    window.postMessage(message, '*');
  }
  
  private async fetchSessionInfo() {
    try {
      const response = await fetch(`${this.sdk.config.apiBaseUrl}/sessions/${this.sessionId}`);
      if (response.ok) {
        this.sessionInfo = await response.json();
        this.updateUI();
      }
    } catch (error) {
      console.error('Failed to fetch session info:', error);
    }
  }
  
  private updateUI() {
    if (!this.element || !this.sessionInfo) return;
    
    const indicator = this.element.querySelector('.status-indicator');
    if (indicator) {
      indicator.className = `status-indicator ${
        this.sessionInfo.status === 'connected' ? 'connected' : ''
      }`;
    }
  }
}

/**
 * Portal Browser View Implementation
 */
class PortalEmbeddedBrowserView extends EventTarget {
  constructor(options) {
    super();
    
    this.viewId = options.viewId;
    this.container = options.container;
    this.sessionId = options.sessionId;
    this.sdk = options.sdk;
    this.options = options;
    
    this.element = null;
    this.browserState = null;
  }
  
  async mount() {
    // Create browser view HTML
    this.element = document.createElement('div');
    this.element.id = this.viewId;
    this.element.className = 'portal-browser-view';
    this.element.innerHTML = this.getBrowserViewHTML();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Append to container
    this.container.appendChild(this.element);
    
    this.dispatchEvent(new CustomEvent('mounted'));
  }
  
  unmount() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
    this.dispatchEvent(new CustomEvent('unmounted'));
  }
  
  updateBrowserState(state) {
    this.browserState = state;
    
    const screenshot = this.element.querySelector('.browser-screenshot');
    if (screenshot && state.screenshot) {
      screenshot.src = `data:image/png;base64,${state.screenshot}`;
      screenshot.style.display = 'block';
    }
    
    this.updateInteractiveElements(state.interactiveElements || []);
    this.dispatchEvent(new CustomEvent('stateUpdated', { detail: state }));
  }
  
  highlightElements(selectors) {
    // Implementation for highlighting specific elements
    console.log('Highlighting elements:', selectors);
  }
  
  clearHighlights() {
    const overlay = this.element.querySelector('.overlay');
    if (overlay) {
      overlay.innerHTML = '';
    }
  }
  
  on(event, handler) {
    this.addEventListener(event, handler);
  }
  
  off(event, handler) {
    this.removeEventListener(event, handler);
  }
  
  private getBrowserViewHTML() {
    return `
      <div class="browser-container">
        <img class="browser-screenshot" style="display: none;" />
        <div class="loading-indicator">
          <div class="spinner"></div>
          <p>Loading browser view...</p>
        </div>
        <div class="overlay"></div>
      </div>
      <style>
        .portal-browser-view {
          position: relative;
          width: 100%;
          height: 100%;
          background: #000;
          border-radius: 8px;
          overflow: hidden;
        }
        .browser-container {
          position: relative;
          width: 100%;
          height: 100%;
        }
        .browser-screenshot {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        .loading-indicator {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
          color: #666;
        }
        .spinner {
          width: 24px;
          height: 24px;
          border: 2px solid #333;
          border-top: 2px solid #3373dc;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 8px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          pointer-events: none;
        }
      </style>
    `;
  }
  
  private setupEventListeners() {
    const screenshot = this.element.querySelector('.browser-screenshot');
    if (screenshot) {
      screenshot.addEventListener('click', (e) => {
        this.dispatchEvent(new CustomEvent('elementClicked', { detail: { event: e } }));
      });
    }
  }
  
  private updateInteractiveElements(elements) {
    const overlay = this.element.querySelector('.overlay');
    if (!overlay) return;
    
    overlay.innerHTML = '';
    
    elements.forEach(element => {
      const highlight = document.createElement('div');
      highlight.style.position = 'absolute';
      highlight.style.left = `${element.bounds.x}px`;
      highlight.style.top = `${element.bounds.y}px`;
      highlight.style.width = `${element.bounds.width}px`;
      highlight.style.height = `${element.bounds.height}px`;
      highlight.style.border = '2px solid #3373dc';
      highlight.style.background = 'rgba(51, 115, 220, 0.1)';
      highlight.style.pointerEvents = 'none';
      highlight.title = element.label || element.selector;
      
      overlay.appendChild(highlight);
    });
  }
}

// Export for use as module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PortalEmbedSDK;
}

// Global for browser
window.PortalEmbedSDK = PortalEmbedSDK;