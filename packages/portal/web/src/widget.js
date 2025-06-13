/**
 * WallCrawler Portal Widget
 * Embeddable component for integrating portal functionality into web and mobile apps
 */
class PortalWidget extends EventTarget {
  constructor(options = {}) {
    super();
    
    this.sessionId = options.sessionId;
    this.apiBaseUrl = options.apiBaseUrl || '/api/portal';
    this.wsEndpoint = options.wsEndpoint;
    this.theme = options.theme || 'dark';
    
    // Widget state
    this.isConnected = false;
    this.isManualControl = false;
    this.sessionInfo = null;
    this.browserState = null;
    
    // WebSocket connection
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    
    // DOM elements
    this.elements = {};
    
    this.init();
  }
  
  init() {
    this.bindElements();
    this.setupEventListeners();
    this.updateUI();
    
    if (this.sessionId) {
      this.connect();
    }
  }
  
  bindElements() {
    this.elements = {
      statusIndicator: document.getElementById('statusIndicator'),
      sessionIdSpan: document.getElementById('sessionId'),
      automationStatus: document.getElementById('automationStatus'),
      connectionStatus: document.getElementById('connectionStatus'),
      screenshot: document.getElementById('screenshot'),
      overlay: document.getElementById('overlay'),
      pauseBtn: document.getElementById('pauseBtn'),
      resumeBtn: document.getElementById('resumeBtn'),
      takeControlBtn: document.getElementById('takeControlBtn'),
      screenshotBtn: document.getElementById('screenshotBtn'),
      fullscreenBtn: document.getElementById('fullscreenBtn')
    };
  }
  
  setupEventListeners() {
    // Control buttons
    this.elements.pauseBtn.addEventListener('click', () => this.pauseAutomation());
    this.elements.resumeBtn.addEventListener('click', () => this.resumeAutomation());
    this.elements.takeControlBtn.addEventListener('click', () => this.toggleManualControl());
    this.elements.screenshotBtn.addEventListener('click', () => this.takeScreenshot());
    this.elements.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    
    // Browser view interactions
    this.elements.screenshot.addEventListener('click', (e) => this.handleBrowserClick(e));
    
    // Window resize
    window.addEventListener('resize', () => this.handleResize());
    
    // Message from parent window (for iframe communication)
    window.addEventListener('message', (e) => this.handleParentMessage(e));
  }
  
  async connect() {
    try {
      // Get session info first
      await this.fetchSessionInfo();
      
      // Connect WebSocket
      await this.connectWebSocket();
      
    } catch (error) {
      console.error('Failed to connect to portal:', error);
      this.showConnectionError(error.message);
    }
  }
  
  async fetchSessionInfo() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/sessions/${this.sessionId}`);
      if (!response.ok) {
        throw new Error(`Session not found: ${response.status}`);
      }
      
      this.sessionInfo = await response.json();
      this.updateSessionInfo();
      
    } catch (error) {
      throw new Error(`Failed to fetch session info: ${error.message}`);
    }
  }
  
  async connectWebSocket() {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = this.wsEndpoint || this.sessionInfo?.wsEndpoint || 'ws://localhost:3001/ws';
        const url = new URL(wsUrl);
        url.searchParams.set('sessionId', this.sessionId);
        
        this.ws = new WebSocket(url.toString());
        
        this.ws.onopen = () => {
          console.log('Portal WebSocket connected');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.updateConnectionStatus();
          this.dispatchEvent(new CustomEvent('connected'));
          
          // Notify parent window if in iframe
          if (window.parent !== window) {
            window.parent.postMessage({ type: 'portal-loaded' }, '*');
          }
          
          resolve();
        };
        
        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleWebSocketMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };
        
        this.ws.onclose = () => {
          console.log('Portal WebSocket disconnected');
          this.isConnected = false;
          this.updateConnectionStatus();
          this.dispatchEvent(new CustomEvent('disconnected'));
          this.attemptReconnect();
        };
        
        this.ws.onerror = (error) => {
          console.error('Portal WebSocket error:', error);
          this.dispatchEvent(new CustomEvent('error', { detail: error }));
          reject(error);
        };
        
        // Connection timeout
        setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, 10000);
        
      } catch (error) {
        reject(error);
      }
    });
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.updateConnectionStatus();
  }
  
  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isConnected) {
        this.connectWebSocket().catch(console.error);
      }
    }, delay);
  }
  
  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'browser-state':
        this.updateBrowserState(message.payload);
        break;
      case 'event':
        this.handlePortalEvent(message.payload);
        break;
      case 'command-response':
        this.handleCommandResponse(message.payload);
        break;
      case 'auth':
        if (message.payload.type === 'welcome') {
          console.log('Portal connection established');
        }
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }
  
  updateBrowserState(state) {
    this.browserState = state;
    
    // Update screenshot
    if (state.screenshot) {
      this.elements.screenshot.src = `data:image/png;base64,${state.screenshot}`;
      this.elements.screenshot.style.display = 'block';
      this.elements.connectionStatus.style.display = 'none';
    }
    
    // Update automation status
    this.elements.automationStatus.textContent = state.automationStatus || 'unknown';
    
    // Update interactive elements
    this.updateInteractiveElements(state.interactiveElements || []);
    
    // Update controls based on state
    this.updateControls();
    
    this.dispatchEvent(new CustomEvent('stateUpdated', { detail: state }));
    
    // Notify parent window if in iframe
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'portal-state-updated',
        data: state
      }, '*');
    }
  }
  
  updateInteractiveElements(elements) {
    // Clear existing highlights
    this.elements.overlay.innerHTML = '';
    
    // Add new highlights
    elements.forEach(element => {
      const highlight = document.createElement('div');
      highlight.className = 'highlight';
      highlight.style.left = `${element.bounds.x}px`;
      highlight.style.top = `${element.bounds.y}px`;
      highlight.style.width = `${element.bounds.width}px`;
      highlight.style.height = `${element.bounds.height}px`;
      highlight.dataset.selector = element.selector;
      highlight.dataset.type = element.type;
      highlight.title = element.label || element.selector;
      
      this.elements.overlay.appendChild(highlight);
    });
  }
  
  handlePortalEvent(event) {
    switch (event.type) {
      case 'session-updated':
        this.sessionInfo = { ...this.sessionInfo, ...event.data };
        this.updateSessionInfo();
        break;
      case 'automation-paused':
      case 'automation-resumed':
      case 'control-taken':
        this.isManualControl = true;
        this.updateControls();
        break;
      case 'control-returned':
        this.isManualControl = false;
        this.updateControls();
        break;
    }
    
    this.dispatchEvent(new CustomEvent('portalEvent', { detail: event }));
  }
  
  handleCommandResponse(response) {
    console.log('Command response:', response);
    
    if (response.success) {
      // Handle successful command responses
      switch (response.commandType) {
        case 'take-screenshot':
          if (response.data && response.data.screenshot) {
            this.dispatchEvent(new CustomEvent('screenshotTaken', { 
              detail: response.data 
            }));
          }
          break;
        case 'take-control':
          this.isManualControl = true;
          this.updateControls();
          break;
        case 'return-control':
          this.isManualControl = false;
          this.updateControls();
          break;
      }
    } else {
      // Handle command errors
      console.error('Command failed:', response.error);
      this.dispatchEvent(new CustomEvent('error', { 
        detail: new Error(response.error || 'Command failed') 
      }));
    }
    
    this.dispatchEvent(new CustomEvent('commandResponse', { detail: response }));
    
    // Also notify parent window if in iframe
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'portal-command-response',
        data: response
      }, '*');
    }
  }
  
  // WebSocket-based control methods
  pauseAutomation() {
    this.sendCommand({
      type: 'pause-automation',
      sessionId: this.sessionId,
      timestamp: Date.now()
    });
  }
  
  resumeAutomation() {
    this.sendCommand({
      type: 'resume-automation',
      sessionId: this.sessionId,
      timestamp: Date.now()
    });
  }
  
  toggleManualControl() {
    const action = this.isManualControl ? 'return-control' : 'take-control';
    this.sendCommand({
      type: action,
      sessionId: this.sessionId,
      timestamp: Date.now()
    });
  }
  
  takeScreenshot() {
    this.sendCommand({
      type: 'take-screenshot',
      sessionId: this.sessionId,
      timestamp: Date.now()
    });
  }
  
  executeAction(action) {
    this.sendCommand({
      type: 'execute-action',
      sessionId: this.sessionId,
      timestamp: Date.now(),
      payload: action
    });
  }
  
  sendCommand(command) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        id: `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'command',
        timestamp: Date.now(),
        sessionId: this.sessionId,
        payload: command
      };
      
      this.ws.send(JSON.stringify(message));
      console.log('Command sent:', command.type);
    } else {
      console.warn('WebSocket not connected, cannot send command');
      this.dispatchEvent(new CustomEvent('error', { 
        detail: new Error('WebSocket not connected') 
      }));
    }
  }
  
  handleBrowserClick(event) {
    if (!this.isManualControl || !this.browserState) {
      return;
    }
    
    const rect = this.elements.screenshot.getBoundingClientRect();
    const scaleX = this.browserState.viewport.width / rect.width;
    const scaleY = this.browserState.viewport.height / rect.height;
    
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    
    this.executeAction({
      type: 'click',
      coordinates: { x, y }
    });
  }
  
  toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  }
  
  handleResize() {
    // Update overlay positioning if needed
    if (this.browserState && this.browserState.interactiveElements) {
      this.updateInteractiveElements(this.browserState.interactiveElements);
    }
  }
  
  handleParentMessage(event) {
    // Handle messages from parent window (for iframe integration)
    switch (event.data.type) {
      case 'portal-resize':
        this.handleResize();
        break;
      case 'portal-theme':
        this.setTheme(event.data.theme);
        break;
      case 'portal-command':
        // Execute command from parent window
        this.executeCommand(event.data.command);
        break;
    }
  }
  
  executeCommand(command) {
    switch (command.type) {
      case 'pause-automation':
        this.pauseAutomation();
        break;
      case 'resume-automation':
        this.resumeAutomation();
        break;
      case 'take-control':
        if (!this.isManualControl) {
          this.toggleManualControl();
        }
        break;
      case 'return-control':
        if (this.isManualControl) {
          this.toggleManualControl();
        }
        break;
      case 'take-screenshot':
        this.takeScreenshot();
        break;
      default:
        console.warn('Unknown command type:', command.type);
    }
  }
  
  setTheme(theme) {
    this.theme = theme;
    document.body.className = `theme-${theme}`;
  }
  
  updateUI() {
    this.updateConnectionStatus();
    this.updateSessionInfo();
    this.updateControls();
  }
  
  updateConnectionStatus() {
    const indicator = this.elements.statusIndicator;
    const status = this.elements.connectionStatus;
    
    if (this.isConnected) {
      indicator.className = 'status-indicator status-connected';
      status.style.display = 'none';
    } else {
      indicator.className = 'status-indicator status-disconnected';
      status.style.display = 'flex';
      status.innerHTML = '<div class="loading"></div><p>Connecting to portal...</p>';
    }
  }
  
  updateSessionInfo() {
    if (this.sessionInfo) {
      this.elements.sessionIdSpan.textContent = this.sessionInfo.sessionId || this.sessionId;
      
      // Notify parent window if in iframe
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'portal-session-info',
          data: this.sessionInfo
        }, '*');
      }
    }
  }
  
  updateControls() {
    const isConnected = this.isConnected;
    const canControl = this.sessionInfo?.canTakeControl !== false;
    const isRunning = this.browserState?.automationStatus === 'running';
    const isPaused = this.browserState?.automationStatus === 'paused';
    
    this.elements.pauseBtn.disabled = !isConnected || !isRunning;
    this.elements.resumeBtn.disabled = !isConnected || !isPaused;
    this.elements.takeControlBtn.disabled = !isConnected || !canControl;
    this.elements.screenshotBtn.disabled = !isConnected;
    
    // Update take control button text
    this.elements.takeControlBtn.textContent = this.isManualControl ? 'Return Control' : 'Take Control';
    this.elements.takeControlBtn.className = this.isManualControl 
      ? 'control-btn danger' 
      : 'control-btn primary';
  }
  
  showConnectionError(message) {
    this.elements.connectionStatus.innerHTML = `
      <div style="color: #f44336;">
        <p>Connection Error</p>
        <p style="font-size: 10px; margin-top: 4px;">${message}</p>
      </div>
    `;
  }
  
  // Public API methods for external control
  getSessionInfo() {
    return this.sessionInfo;
  }
  
  getBrowserState() {
    return this.browserState;
  }
  
  async pause() {
    this.pauseAutomation();
  }
  
  async resume() {
    this.resumeAutomation();
  }
  
  async takeControl() {
    if (!this.isManualControl) {
      this.toggleManualControl();
    }
  }
  
  async returnControl() {
    if (this.isManualControl) {
      this.toggleManualControl();
    }
  }
  
  resize(width, height) {
    if (width) document.documentElement.style.width = typeof width === 'number' ? `${width}px` : width;
    if (height) document.documentElement.style.height = typeof height === 'number' ? `${height}px` : height;
    this.handleResize();
  }
}

// Auto-initialize if sessionId is provided in URL
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get('sessionId');

if (sessionId) {
  window.portalWidget = new PortalWidget({ sessionId });
}

// Export for use as module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PortalWidget;
}

// Global for browser
window.PortalWidget = PortalWidget;