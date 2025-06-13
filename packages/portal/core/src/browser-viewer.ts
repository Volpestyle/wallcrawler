import { EventEmitter } from 'eventemitter3';
import { 
  PortalBrowserState, 
  InteractiveElement,
  AutomationStatus 
} from 'wallcrawler/types/portal';

/**
 * Browser Viewer Component
 * 
 * Manages the visual representation and interaction with the remote browser state.
 * Handles screenshot display, element highlighting, and user interactions.
 */
export class BrowserViewer extends EventEmitter {
  private currentState: PortalBrowserState | null = null;
  private highlightedElements: Set<string> = new Set();
  private selectedElement: string | null = null;
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private overlay: HTMLElement | null = null;

  constructor(container?: HTMLElement) {
    super();
    if (container) {
      this.attachToContainer(container);
    }
  }

  /**
   * Attach the browser viewer to a DOM container
   */
  attachToContainer(container: HTMLElement): void {
    this.container = container;
    this.setupCanvas();
    this.setupOverlay();
    this.setupEventListeners();
  }

  /**
   * Update the browser state and refresh the view
   */
  updateState(state: PortalBrowserState): void {
    const previousState = this.currentState;
    this.currentState = state;
    
    this.emit('stateUpdated', state, previousState);
    
    this.updateCanvas();
    this.updateOverlay();
    this.updateMetadata();
  }

  /**
   * Get the current browser state
   */
  getCurrentState(): PortalBrowserState | null {
    return this.currentState;
  }

  /**
   * Highlight specific elements on the page
   */
  highlightElements(selectors: string[]): void {
    this.highlightedElements.clear();
    selectors.forEach(selector => this.highlightedElements.add(selector));
    this.updateOverlay();
  }

  /**
   * Select an element for interaction
   */
  selectElement(selector: string): void {
    this.selectedElement = selector;
    this.updateOverlay();
    this.emit('elementSelected', selector);
  }

  /**
   * Clear all selections and highlights
   */
  clearSelection(): void {
    this.selectedElement = null;
    this.highlightedElements.clear();
    this.updateOverlay();
    this.emit('selectionCleared');
  }

  /**
   * Get interactive elements at a specific coordinate
   */
  getElementsAtPoint(x: number, y: number): InteractiveElement[] {
    if (!this.currentState?.domState?.interactive) {
      return [];
    }

    return this.currentState.domState.interactive.filter(element => {
      const { bounds } = element;
      return (
        x >= bounds.x &&
        x <= bounds.x + bounds.width &&
        y >= bounds.y &&
        y <= bounds.y + bounds.height &&
        element.visible
      );
    });
  }

  /**
   * Convert screen coordinates to page coordinates
   */
  screenToPageCoordinates(screenX: number, screenY: number): { x: number; y: number } {
    if (!this.canvas || !this.currentState) {
      return { x: screenX, y: screenY };
    }

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.currentState.viewport.width / rect.width;
    const scaleY = this.currentState.viewport.height / rect.height;

    return {
      x: (screenX - rect.left) * scaleX,
      y: (screenY - rect.top) * scaleY
    };
  }

  /**
   * Convert page coordinates to screen coordinates
   */
  pageToScreenCoordinates(pageX: number, pageY: number): { x: number; y: number } {
    if (!this.canvas || !this.currentState) {
      return { x: pageX, y: pageY };
    }

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.currentState.viewport.width;
    const scaleY = rect.height / this.currentState.viewport.height;

    return {
      x: rect.left + (pageX * scaleX),
      y: rect.top + (pageY * scaleY)
    };
  }

  /**
   * Take a screenshot of the current view
   */
  takeScreenshot(): string | null {
    if (!this.canvas) {
      return null;
    }
    return this.canvas.toDataURL('image/png');
  }

  /**
   * Resize the viewer to fit the container
   */
  resize(): void {
    if (!this.container || !this.canvas) {
      return;
    }

    const containerRect = this.container.getBoundingClientRect();
    this.canvas.style.width = `${containerRect.width}px`;
    this.canvas.style.height = `${containerRect.height}px`;
    
    this.updateCanvas();
    this.updateOverlay();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.removeAllListeners();
    if (this.container) {
      this.container.innerHTML = '';
    }
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.overlay = null;
    this.currentState = null;
  }

  private setupCanvas(): void {
    if (!this.container) return;

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      cursor: crosshair;
      z-index: 1;
    `;
    
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);
  }

  private setupOverlay(): void {
    if (!this.container) return;

    this.overlay = document.createElement('div');
    this.overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2;
    `;
    
    this.container.appendChild(this.overlay);
  }

  private setupEventListeners(): void {
    if (!this.canvas) return;

    this.canvas.addEventListener('click', this.handleCanvasClick.bind(this));
    this.canvas.addEventListener('mousemove', this.handleCanvasMouseMove.bind(this));
    this.canvas.addEventListener('contextmenu', this.handleCanvasContextMenu.bind(this));
    
    window.addEventListener('resize', this.resize.bind(this));
  }

  private handleCanvasClick(event: MouseEvent): void {
    const pageCoords = this.screenToPageCoordinates(event.clientX, event.clientY);
    const elements = this.getElementsAtPoint(pageCoords.x, pageCoords.y);
    
    if (elements.length > 0) {
      const topElement = elements[elements.length - 1]; // Get topmost element
      this.selectElement(topElement.selector);
      this.emit('elementClicked', topElement, pageCoords);
    } else {
      this.clearSelection();
      this.emit('backgroundClicked', pageCoords);
    }
  }

  private handleCanvasMouseMove(event: MouseEvent): void {
    const pageCoords = this.screenToPageCoordinates(event.clientX, event.clientY);
    const elements = this.getElementsAtPoint(pageCoords.x, pageCoords.y);
    
    this.emit('mouseMove', pageCoords, elements);
  }

  private handleCanvasContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const pageCoords = this.screenToPageCoordinates(event.clientX, event.clientY);
    const elements = this.getElementsAtPoint(pageCoords.x, pageCoords.y);
    
    this.emit('contextMenu', pageCoords, elements);
  }

  private updateCanvas(): void {
    if (!this.canvas || !this.ctx || !this.currentState?.screenshot) {
      return;
    }

    const img = new Image();
    img.onload = () => {
      if (!this.canvas || !this.ctx) return;
      
      // Set canvas size to match viewport
      this.canvas.width = this.currentState!.viewport.width;
      this.canvas.height = this.currentState!.viewport.height;
      
      // Draw the screenshot
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.drawImage(img, 0, 0);
      
      this.emit('canvasUpdated');
    };
    
    // Handle both base64 with and without data URI prefix
    const screenshot = this.currentState.screenshot;
    img.src = screenshot.startsWith('data:') ? screenshot : `data:image/png;base64,${screenshot}`;
  }

  private updateOverlay(): void {
    if (!this.overlay || !this.currentState) {
      return;
    }

    // Clear existing overlay content
    this.overlay.innerHTML = '';

    // Draw highlighted elements
    this.highlightedElements.forEach(selector => {
      this.drawElementHighlight(selector, 'highlight');
    });

    // Draw selected element
    if (this.selectedElement) {
      this.drawElementHighlight(this.selectedElement, 'selected');
    }
  }

  private drawElementHighlight(selector: string, type: 'highlight' | 'selected'): void {
    if (!this.overlay || !this.currentState?.domState?.interactive) {
      return;
    }

    const element = this.currentState.domState.interactive.find(
      el => el.selector === selector && el.visible
    );

    if (!element) return;

    const highlightDiv = document.createElement('div');
    const { bounds } = element;
    
    highlightDiv.style.cssText = `
      position: absolute;
      left: ${bounds.x}px;
      top: ${bounds.y}px;
      width: ${bounds.width}px;
      height: ${bounds.height}px;
      border: 2px solid ${type === 'selected' ? '#ff4444' : '#44ff44'};
      background: ${type === 'selected' ? 'rgba(255, 68, 68, 0.1)' : 'rgba(68, 255, 68, 0.1)'};
      pointer-events: none;
      z-index: ${type === 'selected' ? 2 : 1};
      box-sizing: border-box;
    `;

    // Add label if element has one
    if (element.label) {
      const label = document.createElement('div');
      label.textContent = element.label;
      label.style.cssText = `
        position: absolute;
        top: -20px;
        left: 0;
        background: ${type === 'selected' ? '#ff4444' : '#44ff44'};
        color: white;
        padding: 2px 6px;
        font-size: 12px;
        font-family: monospace;
        white-space: nowrap;
        border-radius: 2px;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
      `;
      highlightDiv.appendChild(label);
    }

    this.overlay.appendChild(highlightDiv);
  }

  private updateMetadata(): void {
    if (!this.currentState) return;

    this.emit('metadataUpdated', {
      url: this.currentState.url,
      title: this.currentState.title,
      viewport: this.currentState.viewport,
      automationStatus: this.currentState.automationStatus,
      timestamp: this.currentState.timestamp,
      metrics: this.currentState.metrics
    });
  }
}