/**
 * Type augmentations for Radix UI components to ensure React 19 compatibility
 * 
 * This file provides type overrides for Radix UI components that haven't
 * been updated for React 19 yet. These augmentations ensure that the
 * components are recognized as valid JSX element types.
 */

import * as React from 'react';

declare module '@radix-ui/react-dialog' {
  export interface DialogPortalProps {
    children?: React.ReactNode;
  }
}

declare module '@radix-ui/react-popover' {
  export interface PopoverPortalProps {
    children?: React.ReactNode;
  }
}

declare module '@radix-ui/react-dropdown-menu' {
  export interface DropdownMenuPortalProps {
    children?: React.ReactNode;
  }
}

declare module '@radix-ui/react-select' {
  export interface SelectPortalProps {
    children?: React.ReactNode;
  }
}

declare module '@radix-ui/react-tooltip' {
  export interface TooltipPortalProps {
    children?: React.ReactNode;
  }
}

declare module '@radix-ui/react-toast' {
  export interface ToastPortalProps {
    children?: React.ReactNode;
  }
}