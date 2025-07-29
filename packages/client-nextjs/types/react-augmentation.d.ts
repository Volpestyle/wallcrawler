/// <reference types="react" />

/**
 * React 19 Type Augmentations
 * 
 * This file provides type augmentations to ensure compatibility
 * between React 18 and React 19 type systems when used together
 * in a monorepo environment.
 */

declare global {
  namespace React {
    // Augment ReactPortal to include the children property required in React 19
    interface ReactPortal {
      children?: ReactNode;
    }
  }
}

// Ensure this file is treated as a module
export {};