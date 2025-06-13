/**
 * DOM Utility Functions for WallCrawler
 * These functions are injected into the browser page context
 */

export const DOM_UTILS_SCRIPT = `
// DOM Utility Functions for WallCrawler
(function() {
  'use strict';

  // Get all scrollable elements and return their XPaths
  window.getScrollableElementXpaths = function() {
    const scrollables = [];
    const elements = document.querySelectorAll('*');
    
    for (const el of elements) {
      const style = window.getComputedStyle(el);
      if (
        (style.overflow === 'scroll' || style.overflow === 'auto' ||
         style.overflowX === 'scroll' || style.overflowX === 'auto' ||
         style.overflowY === 'scroll' || style.overflowY === 'auto') &&
        (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)
      ) {
        scrollables.push(generateXPath(el));
      }
    }
    
    return scrollables;
  };

  // Generate XPath for an element
  window.generateXPath = function(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    if (element.id !== '') {
      return \`//\${element.tagName.toLowerCase()}[@id="\${element.id}"]\`;
    }
    
    if (element === document.body) {
      return '//body';
    }

    if (element === document.documentElement) {
      return '/html';
    }
    
    let ix = 0;
    const siblings = element.parentNode?.children || [];
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        const parentXPath = generateXPath(element.parentNode);
        return \`\${parentXPath}/\${element.tagName.toLowerCase()}[\${ix + 1}]\`;
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
    
    return '';
  };

  // Generate CSS selector for an element
  window.generateSelector = function(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    if (element.id) {
      return \`#\${element.id}\`;
    }

    let selector = element.tagName.toLowerCase();
    
    if (element.className) {
      const classes = element.className.trim().split(/\\s+/).filter(c => c.length > 0);
      if (classes.length > 0) {
        selector += '.' + classes.join('.');
      }
    }

    let parent = element.parentElement;
    while (parent && parent !== document.body) {
      let parentSelector = parent.tagName.toLowerCase();
      
      if (parent.id) {
        return \`#\${parent.id} \${selector}\`;
      }
      
      if (parent.className) {
        const classes = parent.className.trim().split(/\\s+/).filter(c => c.length > 0);
        if (classes.length > 0) {
          parentSelector += '.' + classes.join('.');
        }
      }
      
      selector = \`\${parentSelector} \${selector}\`;
      parent = parent.parentElement;
    }

    return selector;
  };

  // Check if element is interactive
  window.isInteractive = function(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const tagName = element.tagName.toLowerCase();
    const interactiveTags = ['a', 'button', 'input', 'textarea', 'select', 'option'];
    
    if (interactiveTags.includes(tagName)) {
      return true;
    }

    if (element.hasAttribute('onclick') || 
        element.hasAttribute('onmousedown') || 
        element.hasAttribute('onmouseup') ||
        element.hasAttribute('role')) {
      return true;
    }

    const style = window.getComputedStyle(element);
    if (style.cursor === 'pointer') {
      return true;
    }

    return false;
  };

  // Get all attributes of an element
  window.getAttributes = function(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return {};
    }

    const attrs = {};
    for (const attr of element.attributes) {
      attrs[attr.name] = attr.value;
    }
    
    return attrs;
  };

  console.log('WallCrawler DOM utilities loaded');
})();
`;