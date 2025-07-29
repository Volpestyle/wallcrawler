import * as React from 'react';

/**
 * React 19 Compatibility Layer
 * 
 * This file provides type utilities and wrappers to ensure compatibility
 * between React 19 and libraries that haven't fully migrated yet (like Radix UI).
 * 
 * The main issues addressed:
 * 1. ReactNode type changes in React 19
 * 2. ForwardRef component type strictness
 * 3. Children prop handling in portals
 */

/**
 * Enhanced forwardRef that ensures React 19 compatibility
 * This wrapper adds proper typing for the ref and ensures the component
 * is recognized as a valid JSX element type in React 19.
 */
export const forwardRefWithGenerics = React.forwardRef as <T, P = {}>(
  render: (props: P, ref: React.Ref<T>) => React.ReactNode
) => ((props: P & React.RefAttributes<T>) => React.ReactNode) & {
  displayName?: string;
};

/**
 * Type helper for components that need to be compatible with both
 * React 18 and React 19 type systems.
 */
export type CompatibleComponent<P = {}> = (props: P) => React.ReactNode;

/**
 * Ensures a component's children prop is properly typed for React 19
 */
export type WithChildren<P = {}> = P & {
  children?: React.ReactNode;
};

/**
 * Helper to create a component wrapper that ensures React 19 compatibility.
 * This wrapper ensures the component returns a synchronous ReactNode,
 * which is required for JSX compatibility in React 19.
 */
export function createCompatibleComponent<P extends Record<string, any>>(
  Component: React.ComponentType<P> | ((props: P) => React.ReactNode),
  displayName?: string
): CompatibleComponent<P> {
  const CompatComponent: CompatibleComponent<P> = (props: P) => {
    return React.createElement(Component as any, props);
  };

  if (displayName) {
    (CompatComponent as any).displayName = displayName;
  }

  return CompatComponent;
}

/**
 * Type guard to check if a value is a valid React element
 */
export function isValidElement(value: any): value is React.ReactElement {
  return React.isValidElement(value);
}

/**
 * Ensures props are compatible with React 19's stricter type system
 */
export function ensureValidProps<P extends Record<string, any>>(
  props: P
): P {
  // Remove undefined values that might cause issues
  const cleanProps = {} as P;

  for (const key in props) {
    if (props[key] !== undefined) {
      cleanProps[key] = props[key];
    }
  }

  return cleanProps;
}

/**
 * Wrapper for Radix UI primitive components to ensure React 19 compatibility.
 * This is specifically for components that don't need additional wrapping logic.
 */
export function wrapRadixPrimitive<P extends Record<string, any>>(
  Component: React.ComponentType<P>
): CompatibleComponent<P> {
  return createCompatibleComponent(Component, (Component as any).displayName || 'WrappedComponent');
}