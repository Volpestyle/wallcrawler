import { Page } from "playwright";
import { ObserveResult } from "../types/handlers";
import { createLogger } from "./logger";

const logger = createLogger("overlay");

export async function drawObserveOverlay(
  page: Page,
  elements: ObserveResult[]
): Promise<void> {
  try {
    // Convert ObserveResults to selectors like Stagehand does
    const selectors = elements.map((result) => result.selector);
    
    // Filter out empty selectors
    const validSelectors = selectors.filter((selector) => selector && selector !== "xpath=");

    await page.evaluate((selectors) => {
      // Remove any existing overlays
      const existingOverlays = document.querySelectorAll('[data-wallcrawler-overlay]');
      existingOverlays.forEach(el => el.remove());

      selectors.forEach((selector) => {
        let element;
        
        // Handle xpath and CSS selectors like Stagehand
        if (selector.startsWith("xpath=")) {
          const xpath = selector.substring(6);
          element = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          ).singleNodeValue;
        } else {
          element = document.querySelector(selector);
        }

        if (element instanceof HTMLElement) {
          // Get element position dynamically like Stagehand
          const rect = element.getBoundingClientRect();
          
          // Create overlay element
          const overlay = document.createElement("div");
          overlay.setAttribute("data-wallcrawler-overlay", "true");
          overlay.style.position = "absolute";
          overlay.style.left = rect.left + "px";
          overlay.style.top = rect.top + "px";
          overlay.style.width = rect.width + "px";
          overlay.style.height = rect.height + "px";
          overlay.style.backgroundColor = "rgba(255, 0, 128, 0.3)"; // WallCrawler pink
          overlay.style.border = "2px solid #ff0080";
          overlay.style.pointerEvents = "none";
          overlay.style.zIndex = "10000";
          document.body.appendChild(overlay);
        }
      });

      // Auto-remove overlay after 5 seconds
      setTimeout(() => {
        const overlays = document.querySelectorAll('[data-wallcrawler-overlay]');
        overlays.forEach(el => el.remove());
      }, 5000);
    }, validSelectors);

    logger.info("Drew overlay for observed elements", { count: elements.length });
  } catch (error) {
    logger.error("Failed to draw overlay", { error: (error as Error).message });
  }
}

export async function clearOverlays(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const overlays = document.querySelectorAll('[data-wallcrawler-overlay]');
      overlays.forEach(el => el.remove());
    });
    logger.debug("Cleared overlay elements");
  } catch (error) {
    logger.debug("Failed to clear overlays", { error: (error as Error).message });
  }
}