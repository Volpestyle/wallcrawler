'use client';

import * as React from 'react';

export interface ToastProps {
  variant?: 'default' | 'destructive';
  className?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: ToastActionElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export type ToastActionElement = React.ReactElement;
