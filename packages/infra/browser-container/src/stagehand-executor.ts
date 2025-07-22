/**
 * Stagehand Operations Executor
 * Implements high-level Stagehand operations using CDP and Playwright
 */

import { Page, CDPSession, BrowserContext } from 'playwright-core';
import { createClient } from 'redis';

// Simplified types for Stagehand operations
interface StagehandActOptions {
    action: string;
    variables?: Record<string, string>;
    domSettleTimeoutMs?: number;
    timeoutMs?: number;
}

interface StagehandExtractOptions {
    instruction?: string;
    schema?: Record<string, unknown>;
    domSettleTimeoutMs?: number;
    selector?: string;
}

interface StagehandObserveOptions {
    instruction?: string;
    domSettleTimeoutMs?: number;
    returnAction?: boolean;
    drawOverlay?: boolean;
}

interface StagehandActResult {
    success: boolean;
    message: string;
    action: string;
}

interface StagehandObserveResult {
    selector: string;
    description: string;
    method?: string;
    arguments?: string[];
}

interface Session {
    id: string;
    userId: string;
    context: BrowserContext;
    pages: Map<string, Page>;
    cdpSessions: Map<string, CDPSession>;
    lastActivity: number;
}

export class StagehandExecutor {
    private redis: ReturnType<typeof createClient>;

    constructor(redisClient: ReturnType<typeof createClient>) {
        this.redis = redisClient;
    }

    /**
     * Execute an act operation
     */
    async executeAct(session: Session, options: StagehandActOptions): Promise<StagehandActResult> {
        try {
            const page = session.pages.get('main');
            if (!page) {
                throw new Error('No main page found for session');
            }

            // Wait for DOM to settle
            await this.waitForDomSettle(page, options.domSettleTimeoutMs || 30000);

            // Get accessibility tree for element observation
            const accessibilityTree = await this.getAccessibilityTree(session);

            // Use simple heuristics to find elements based on action
            const element = await this.findElementForAction(page, options.action, accessibilityTree);

            if (!element) {
                return {
                    success: false,
                    message: `Could not find element for action: ${options.action}`,
                    action: options.action
                };
            }

            // Execute the action
            await this.performAction(page, element, options.action, options.variables);

            return {
                success: true,
                message: `Successfully executed action: ${options.action}`,
                action: options.action
            };

        } catch (error) {
            console.error('Act execution error:', error);
            return {
                success: false,
                message: error instanceof Error ? error.message : 'Unknown error during act execution',
                action: options.action
            };
        }
    }

    /**
     * Execute an extract operation
     */
    async executeExtract(session: Session, options: StagehandExtractOptions): Promise<Record<string, unknown>> {
        try {
            const page = session.pages.get('main');
            if (!page) {
                throw new Error('No main page found for session');
            }

            // Wait for DOM to settle
            await this.waitForDomSettle(page, options.domSettleTimeoutMs || 30000);

            let result: Record<string, unknown>;

            if (options.selector) {
                // Extract from specific selector
                result = await this.extractFromSelector(page, options.selector, options.instruction);
            } else {
                // Extract page content
                result = await this.extractPageContent(page, options.instruction);
            }

            return result;

        } catch (error) {
            console.error('Extract execution error:', error);
            return {
                error: error instanceof Error ? error.message : 'Unknown error during extract execution'
            };
        }
    }

    /**
     * Execute an observe operation
     */
    async executeObserve(session: Session, options: StagehandObserveOptions): Promise<StagehandObserveResult[]> {
        try {
            const page = session.pages.get('main');
            if (!page) {
                throw new Error('No main page found for session');
            }

            // Wait for DOM to settle
            await this.waitForDomSettle(page, options.domSettleTimeoutMs || 30000);

            // Get accessibility tree
            const accessibilityTree = await this.getAccessibilityTree(session);

            // Find interactive elements
            const elements = await this.findInteractiveElements(page, accessibilityTree, options.instruction);

            return elements;

        } catch (error) {
            console.error('Observe execution error:', error);
            return [];
        }
    }

    /**
     * Wait for DOM to settle (no changes for a period)
     */
    private async waitForDomSettle(page: Page, timeout: number): Promise<void> {
        try {
            await page.waitForLoadState('domcontentloaded', { timeout });

            // Wait for any ongoing network requests
            await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 10000) });

            // Additional wait for dynamic content
            await page.waitForTimeout(1000);
        } catch (_error) {
            console.warn('DOM settle timeout, continuing anyway');
        }
    }

    /**
     * Get accessibility tree from the page
     */
    private async getAccessibilityTree(session: Session): Promise<any> {
        try {
            const cdpSession = session.cdpSessions.get('main');
            if (!cdpSession) {
                throw new Error('No CDP session found');
            }

            const { nodes } = await cdpSession.send('Accessibility.getFullAXTree');
            return nodes;
        } catch (error) {
            console.warn('Failed to get accessibility tree:', error);
            return [];
        }
    }

    /**
     * Find element for a given action using simple heuristics
     */
    private async findElementForAction(page: Page, action: string, _axTree: any[]): Promise<any> {
        const actionLower = action.toLowerCase();

        // Simple keyword matching for common actions
        if (actionLower.includes('click') || actionLower.includes('button')) {
            return await page.locator('button, [role="button"], input[type="submit"], a').first();
        }

        if (actionLower.includes('type') || actionLower.includes('input') || actionLower.includes('fill')) {
            return await page.locator('input[type="text"], input[type="email"], input[type="password"], textarea').first();
        }

        if (actionLower.includes('select') || actionLower.includes('dropdown')) {
            return await page.locator('select, [role="combobox"]').first();
        }

        // Default: try to find any interactive element
        return await page.locator('button, input, select, textarea, a, [role="button"]').first();
    }

    /**
     * Perform the actual action on an element
     */
    private async performAction(page: Page, element: any, action: string, variables?: Record<string, string>): Promise<void> {
        const actionLower = action.toLowerCase();

        if (actionLower.includes('click')) {
            await element.click();
        } else if (actionLower.includes('type') || actionLower.includes('fill')) {
            // Extract text to type from action or variables
            let textToType = '';
            if (variables) {
                const textMatch = action.match(/["'](.*?)["']/);
                if (textMatch) {
                    textToType = textMatch[1];
                    // Replace variables
                    Object.entries(variables).forEach(([key, value]) => {
                        textToType = textToType.replace(`%${key}%`, value);
                    });
                }
            }

            if (textToType) {
                await element.fill(textToType);
            }
        } else if (actionLower.includes('select')) {
            // For select elements, try to select first option
            const options = await element.locator('option').all();
            if (options.length > 1) {
                await element.selectOption({ index: 1 }); // Skip first option (usually placeholder)
            }
        } else {
            // Default action is click
            await element.click();
        }
    }

    /**
     * Extract content from a specific selector
     */
    private async extractFromSelector(page: Page, selector: string, _instruction?: string): Promise<Record<string, unknown>> {
        try {
            const element = page.locator(selector);
            const text = await element.textContent();
            const value = await element.inputValue().catch(() => null);
            const href = await element.getAttribute('href').catch(() => null);

            return {
                text: text || '',
                value: value || '',
                href: href || '',
                selector
            };
        } catch (error) {
            return {
                error: `Failed to extract from selector ${selector}: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Extract general page content
     */
    private async extractPageContent(page: Page, _instruction?: string): Promise<Record<string, unknown>> {
        try {
            const title = await page.title();
            const url = page.url();
            const content = await page.textContent('body');

            return {
                title,
                url,
                page_text: content || '',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                error: `Failed to extract page content: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    /**
     * Find interactive elements on the page
     */
    private async findInteractiveElements(page: Page, _axTree: any[], _instruction?: string): Promise<StagehandObserveResult[]> {
        try {
            const elements: StagehandObserveResult[] = [];

            // Find buttons
            const buttons = await page.locator('button, [role="button"], input[type="submit"]').all();
            for (let i = 0; i < Math.min(buttons.length, 5); i++) {
                const button = buttons[i];
                const text = await button.textContent();
                if (text && text.trim()) {
                    elements.push({
                        selector: `button:nth-child(${i + 1})`,
                        description: `Button: ${text.trim()}`,
                        method: 'click',
                        arguments: []
                    });
                }
            }

            // Find input fields
            const inputs = await page.locator('input[type="text"], input[type="email"], input[type="password"], textarea').all();
            for (let i = 0; i < Math.min(inputs.length, 5); i++) {
                const input = inputs[i];
                const placeholder = await input.getAttribute('placeholder');
                const label = await input.getAttribute('aria-label');
                const description = label || placeholder || `Input field ${i + 1}`;

                elements.push({
                    selector: `input:nth-child(${i + 1})`,
                    description: `Input: ${description}`,
                    method: 'fill',
                    arguments: ['text to enter']
                });
            }

            // Find links
            const links = await page.locator('a[href]').all();
            for (let i = 0; i < Math.min(links.length, 3); i++) {
                const link = links[i];
                const text = await link.textContent();
                if (text && text.trim()) {
                    elements.push({
                        selector: `a:nth-child(${i + 1})`,
                        description: `Link: ${text.trim()}`,
                        method: 'click',
                        arguments: []
                    });
                }
            }

            return elements;

        } catch (error) {
            console.error('Error finding interactive elements:', error);
            return [];
        }
    }
} 