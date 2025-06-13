import { PortalCore } from '@wallcrawler/portal-core';
import type { 
  PortalTransport,
  PortalBrowserState,
  PortalSession,
  InteractiveElement,
  ActionInfo 
} from '@wallcrawler/portal-core';

/**
 * Portal Web Application
 * 
 * Main application class that handles the web UI for the WallCrawler agent portal.
 * Coordinates between the DOM, portal core, and transport layer.
 */
class PortalWebApp {
  private portalCore: PortalCore;
  private transport: PortalTransport | null = null;
  private session: PortalSession | null = null;
  private currentState: PortalBrowserState | null = null;
  private selectedElement: InteractiveElement | null = null;
  private sessionStartTime: number = 0;
  private elements: { [key: string]: HTMLElement } = {};
  private isFullscreen = false;

  constructor() {
    this.portalCore = new PortalCore({
      allowManualControl: true,
      allowScriptInjection: false,
      enableMetrics: true,
      theme: 'dark'
    });

    this.initializeElements();
    this.setupEventListeners();
    this.setupPortalCoreEvents();
  }

  /**
   * Initialize the portal application
   */
  async initialize(): Promise<void> {
    try {
      this.showLoading();
      
      // Get session ID from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const sessionId = urlParams.get('sessionId') || urlParams.get('session');
      const token = urlParams.get('token');
      
      if (!sessionId) {
        throw new Error('No session ID provided in URL parameters');
      }

      // Create transport (this would be injected based on environment)
      this.transport = this.createTransport();
      
      // Initialize portal core
      await this.portalCore.initialize(this.transport);
      
      // Connect to session
      const auth = token ? {
        type: 'token' as const,
        credentials: { token }
      } : undefined;
      
      this.session = await this.portalCore.connect(sessionId, auth);
      this.sessionStartTime = Date.now();
      
      // Attach browser viewer
      const viewerContainer = this.elements.browserViewer;
      if (viewerContainer) {
        this.portalCore.attachViewer(viewerContainer);
      }
      
      this.showPortal();
      this.updateSessionInfo();
      this.startPeriodicUpdates();
      
    } catch (error) {
      console.error('Failed to initialize portal:', error);
      this.showError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    await this.portalCore.destroy();
  }

  private initializeElements(): void {
    // Get all important DOM elements
    this.elements = {
      loading: document.getElementById('loading')!,
      portal: document.getElementById('portal')!,
      error: document.getElementById('error')!,
      
      // Header elements
      sessionId: document.getElementById('session-id')!,
      connectionStatus: document.getElementById('connection-status')!,
      
      // Control buttons
      pauseBtn: document.getElementById('pause-btn')!,
      resumeBtn: document.getElementById('resume-btn')!,
      takeControlBtn: document.getElementById('take-control-btn')!,
      screenshotBtn: document.getElementById('screenshot-btn')!,
      closeBtn: document.getElementById('close-btn')!,
      reloadBtn: document.getElementById('reload-btn')!,
      fullscreenBtn: document.getElementById('fullscreen-btn')!,
      retryBtn: document.getElementById('retry-btn')!,
      
      // Browser section
      currentUrl: document.getElementById('current-url')!,
      pageTitle: document.getElementById('page-title')!,
      browserViewer: document.getElementById('browser-viewer')!,
      
      // Sidebar elements
      automationStatus: document.getElementById('automation-status')!,
      lastAction: document.getElementById('last-action')!,
      sessionDuration: document.getElementById('session-duration')!,
      actionHistory: document.getElementById('action-history')!,
      elementInspector: document.getElementById('element-inspector')!,
      
      // Manual controls
      manualActionType: document.getElementById('manual-action-type')! as HTMLSelectElement,
      manualSelector: document.getElementById('manual-selector')! as HTMLInputElement,
      manualValue: document.getElementById('manual-value')! as HTMLInputElement,
      executeManualAction: document.getElementById('execute-manual-action')!,
      
      // Footer
      connectionInfo: document.getElementById('connection-info')!,
      latencyInfo: document.getElementById('latency-info')!,
      messagesInfo: document.getElementById('messages-info')!,
      
      // Modals
      modalOverlay: document.getElementById('modal-overlay')!,
      screenshotModal: document.getElementById('screenshot-modal')!,
      screenshotImage: document.getElementById('screenshot-image')! as HTMLImageElement,
      downloadScreenshot: document.getElementById('download-screenshot')!,
      
      // Context menu
      contextMenu: document.getElementById('context-menu')!,
      
      // Error elements
      errorMessage: document.getElementById('error-message')!
    };
  }

  private setupEventListeners(): void {
    // Control button events
    this.elements.pauseBtn.addEventListener('click', () => this.handlePause());
    this.elements.resumeBtn.addEventListener('click', () => this.handleResume());
    this.elements.takeControlBtn.addEventListener('click', () => this.handleTakeControl());
    this.elements.screenshotBtn.addEventListener('click', () => this.handleScreenshot());
    this.elements.closeBtn.addEventListener('click', () => this.handleClose());
    this.elements.reloadBtn.addEventListener('click', () => this.handleReload());
    this.elements.fullscreenBtn.addEventListener('click', () => this.handleFullscreen());
    this.elements.retryBtn.addEventListener('click', () => this.initialize());
    
    // Manual control events
    this.elements.executeManualAction.addEventListener('click', () => this.handleExecuteManualAction());
    
    // Modal events
    this.elements.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.elements.modalOverlay) {
        this.hideModal();
      }
    });
    
    this.elements.downloadScreenshot.addEventListener('click', () => this.handleDownloadScreenshot());
    
    // Modal close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => this.hideModal());
    });
    
    // Context menu events
    document.addEventListener('click', () => this.hideContextMenu());
    this.elements.contextMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const menuItem = (e.target as HTMLElement).closest('.menu-item');
      if (menuItem) {
        this.handleContextMenuAction(menuItem.getAttribute('data-action')!);
      }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeydown(e));
    
    // Fullscreen change events
    document.addEventListener('fullscreenchange', () => this.updateFullscreenButton());
  }

  private setupPortalCoreEvents(): void {
    // Connection events
    this.portalCore.on('connected', (session) => {
      this.updateConnectionStatus('connected');
      this.updateSessionInfo();
    });
    
    this.portalCore.on('disconnected', () => {
      this.updateConnectionStatus('disconnected');
    });
    
    this.portalCore.on('connectionError', (error) => {
      this.showError(`Connection error: ${error.message}`);
    });
    
    // Browser state events
    this.portalCore.on('browserStateUpdated', (state) => {
      this.updateBrowserState(state);
    });
    
    // Element selection events
    this.portalCore.on('elementSelected', (selector) => {
      this.updateElementInspector(selector);
      this.elements.manualSelector.value = selector;
    });
    
    this.portalCore.on('elementClicked', (element, coords) => {
      this.selectedElement = element;
      this.updateElementInspector(element.selector);
    });
    
    this.portalCore.on('contextMenu', (coords, elements) => {
      this.showContextMenu(coords.x, coords.y, elements);
    });
    
    // Command events
    this.portalCore.on('commandError', (command, error) => {
      this.showNotification(`Command failed: ${error.message}`, 'error');
    });
  }

  private showLoading(): void {
    this.elements.loading.style.display = 'flex';
    this.elements.portal.style.display = 'none';
    this.elements.error.style.display = 'none';
  }

  private showPortal(): void {
    this.elements.loading.style.display = 'none';
    this.elements.portal.style.display = 'flex';
    this.elements.error.style.display = 'none';
  }

  private showError(message: string): void {
    this.elements.loading.style.display = 'none';
    this.elements.portal.style.display = 'none';
    this.elements.error.style.display = 'flex';
    this.elements.errorMessage.textContent = message;
  }

  private updateConnectionStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    const statusElement = this.elements.connectionStatus;
    statusElement.className = `status-indicator ${status}`;
    statusElement.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  }

  private updateSessionInfo(): void {
    if (this.session) {
      this.elements.sessionId.textContent = `Session: ${this.session.sessionId}`;
    }
  }

  private updateBrowserState(state: PortalBrowserState): void {
    this.currentState = state;
    
    // Update browser info
    this.elements.currentUrl.textContent = state.url;
    this.elements.pageTitle.textContent = state.title;
    
    // Update automation status
    this.elements.automationStatus.textContent = state.automationStatus;
    this.elements.automationStatus.className = `status-value ${state.automationStatus}`;
    
    // Update last action
    if (state.lastAction) {
      this.elements.lastAction.textContent = `${state.lastAction.description} (${state.lastAction.success ? 'Success' : 'Failed'})`;
    }
    
    // Update action history
    this.updateActionHistory(state.actionHistory);
    
    // Update session duration
    this.updateSessionDuration();
    
    // Update footer info
    this.elements.connectionInfo.textContent = this.portalCore.isConnected() ? 'Connected' : 'Disconnected';
  }

  private updateActionHistory(actions: ActionInfo[]): void {
    const historyContainer = this.elements.actionHistory;
    
    if (actions.length === 0) {
      historyContainer.innerHTML = '<div class="no-actions">No actions yet</div>';
      return;
    }
    
    historyContainer.innerHTML = '';
    
    // Show last 10 actions
    const recentActions = actions.slice(-10);
    
    recentActions.forEach(action => {
      const actionElement = document.createElement('div');
      actionElement.className = `action-item ${action.success === false ? 'error' : action.success === true ? 'success' : 'pending'}`;
      
      actionElement.innerHTML = `
        <div class="action-timestamp">${new Date(action.timestamp).toLocaleTimeString()}</div>
        <div class="action-description">${action.description}</div>
      `;
      
      historyContainer.appendChild(actionElement);
    });
    
    // Scroll to bottom
    historyContainer.scrollTop = historyContainer.scrollHeight;
  }

  private updateElementInspector(selector: string): void {
    const inspector = this.elements.elementInspector;
    
    if (!this.currentState?.domState?.interactive) {
      inspector.innerHTML = '<div class="no-selection">No element data available</div>';
      return;
    }
    
    const element = this.currentState.domState.interactive.find(el => el.selector === selector);
    
    if (!element) {
      inspector.innerHTML = '<div class="no-selection">Element not found</div>';
      return;
    }
    
    inspector.innerHTML = `
      <div class="element-details">
        <div class="element-property">
          <span class="property-label">Tag:</span>
          <span class="property-value">${element.tagName}</span>
        </div>
        <div class="element-property">
          <span class="property-label">Type:</span>
          <span class="property-value">${element.type || 'N/A'}</span>
        </div>
        <div class="element-property">
          <span class="property-label">Selector:</span>
          <span class="property-value">${element.selector}</span>
        </div>
        <div class="element-property">
          <span class="property-label">Visible:</span>
          <span class="property-value">${element.visible ? 'Yes' : 'No'}</span>
        </div>
        <div class="element-property">
          <span class="property-label">Interactable:</span>
          <span class="property-value">${element.interactable ? 'Yes' : 'No'}</span>
        </div>
        ${element.label ? `
        <div class="element-property">
          <span class="property-label">Label:</span>
          <span class="property-value">${element.label}</span>
        </div>` : ''}
        ${element.value ? `
        <div class="element-property">
          <span class="property-label">Value:</span>
          <span class="property-value">${element.value}</span>
        </div>` : ''}
      </div>
    `;
  }

  private updateSessionDuration(): void {
    if (this.sessionStartTime) {
      const duration = Date.now() - this.sessionStartTime;
      const hours = Math.floor(duration / 3600000);
      const minutes = Math.floor((duration % 3600000) / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      
      this.elements.sessionDuration.textContent = 
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  // Event handlers
  private async handlePause(): Promise<void> {
    try {
      await this.portalCore.sendCommand('pause');
      this.showNotification('Automation paused', 'success');
    } catch (error) {
      this.showNotification('Failed to pause automation', 'error');
    }
  }

  private async handleResume(): Promise<void> {
    try {
      await this.portalCore.sendCommand('resume');
      this.showNotification('Automation resumed', 'success');
    } catch (error) {
      this.showNotification('Failed to resume automation', 'error');
    }
  }

  private async handleTakeControl(): Promise<void> {
    try {
      await this.portalCore.sendCommand('take-control');
      this.showNotification('Manual control activated', 'success');
    } catch (error) {
      this.showNotification('Failed to take control', 'error');
    }
  }

  private async handleScreenshot(): Promise<void> {
    try {
      await this.portalCore.sendCommand('screenshot');
      this.showNotification('Screenshot requested', 'success');
    } catch (error) {
      this.showNotification('Failed to take screenshot', 'error');
    }
  }

  private async handleClose(): Promise<void> {
    if (confirm('Are you sure you want to close the portal?')) {
      try {
        await this.portalCore.sendCommand('close-portal');
        window.close();
      } catch (error) {
        this.showNotification('Failed to close portal', 'error');
      }
    }
  }

  private async handleReload(): Promise<void> {
    try {
      await this.portalCore.sendCommand('reload');
      this.showNotification('Page reload requested', 'success');
    } catch (error) {
      this.showNotification('Failed to reload page', 'error');
    }
  }

  private handleFullscreen(): void {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }

  private updateFullscreenButton(): void {
    const btn = this.elements.fullscreenBtn;
    this.isFullscreen = !!document.fullscreenElement;
    btn.textContent = this.isFullscreen ? '⛶' : '⛶';
    btn.title = this.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
  }

  private async handleExecuteManualAction(): Promise<void> {
    const actionType = this.elements.manualActionType.value;
    const selector = this.elements.manualSelector.value.trim();
    const value = this.elements.manualValue.value;
    
    if (!selector) {
      this.showNotification('Please provide a selector', 'error');
      return;
    }
    
    try {
      await this.portalCore.sendCommand('execute-action', {
        action: actionType,
        selector,
        value: value || undefined
      });
      
      this.showNotification(`${actionType} action executed`, 'success');
    } catch (error) {
      this.showNotification(`Failed to execute ${actionType}`, 'error');
    }
  }

  private handleDownloadScreenshot(): void {
    if (this.currentState?.screenshot) {
      const link = document.createElement('a');
      link.href = this.currentState.screenshot.startsWith('data:') 
        ? this.currentState.screenshot 
        : `data:image/png;base64,${this.currentState.screenshot}`;
      link.download = `wallcrawler-screenshot-${Date.now()}.png`;
      link.click();
    }
  }

  private showContextMenu(x: number, y: number, elements: InteractiveElement[]): void {
    const menu = this.elements.contextMenu;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';
    
    // Adjust position if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${y - rect.height}px`;
    }
  }

  private hideContextMenu(): void {
    this.elements.contextMenu.style.display = 'none';
  }

  private handleContextMenuAction(action: string): void {
    this.hideContextMenu();
    
    switch (action) {
      case 'click':
        if (this.selectedElement) {
          this.handleExecuteAction('click', this.selectedElement.selector);
        }
        break;
      case 'inspect':
        if (this.selectedElement) {
          this.updateElementInspector(this.selectedElement.selector);
        }
        break;
      case 'copy-selector':
        if (this.selectedElement) {
          navigator.clipboard.writeText(this.selectedElement.selector);
          this.showNotification('Selector copied to clipboard', 'success');
        }
        break;
      case 'screenshot':
        this.handleScreenshot();
        break;
    }
  }

  private async handleExecuteAction(action: string, selector: string, value?: any): Promise<void> {
    try {
      await this.portalCore.sendCommand('execute-action', {
        action,
        selector,
        value
      });
      this.showNotification(`${action} action executed`, 'success');
    } catch (error) {
      this.showNotification(`Failed to execute ${action}`, 'error');
    }
  }

  private handleKeydown(event: KeyboardEvent): void {
    // Keyboard shortcuts
    if (event.ctrlKey || event.metaKey) {
      switch (event.key) {
        case 'p':
          event.preventDefault();
          this.handlePause();
          break;
        case 'r':
          event.preventDefault();
          this.handleResume();
          break;
        case 's':
          event.preventDefault();
          this.handleScreenshot();
          break;
      }
    }
    
    // Escape key
    if (event.key === 'Escape') {
      this.hideModal();
      this.hideContextMenu();
    }
  }

  private showModal(): void {
    this.elements.modalOverlay.style.display = 'flex';
  }

  private hideModal(): void {
    this.elements.modalOverlay.style.display = 'none';
  }

  private showNotification(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    // Simple notification system
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
      color: white;
      padding: 12px 16px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      z-index: 3000;
      font-size: 14px;
      max-width: 300px;
      word-wrap: break-word;
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease forwards';
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }

  private startPeriodicUpdates(): void {
    // Update session duration every second
    setInterval(() => {
      this.updateSessionDuration();
    }, 1000);
  }

  private createTransport(): PortalTransport {
    // This is a placeholder - in real implementation, this would create
    // the appropriate transport based on environment (local WebSocket, AWS API Gateway, etc.)
    throw new Error('Transport creation not implemented - this depends on deployment environment');
  }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const app = new PortalWebApp();
  app.initialize().catch(console.error);
  
  // Make app available globally for debugging
  (window as any).portalApp = app;
});

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);