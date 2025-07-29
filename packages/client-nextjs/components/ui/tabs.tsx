import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';
import { 
  forwardRefWithGenerics, 
  createCompatibleComponent,
  type WithChildren 
} from '@/lib/react19-compat';

const Tabs = createCompatibleComponent<WithChildren<React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>>>(
  ({ children, ...props }) => (
    <TabsPrimitive.Root {...props}>{children}</TabsPrimitive.Root>
  ),
  'Tabs'
);

const TabsList = forwardRefWithGenerics<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-center rounded-lg bg-surface p-1 text-text-secondary',
      className
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName || 'TabsList';

const TabsTrigger = forwardRefWithGenerics<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-text-primary data-[state=active]:shadow-sm',
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName || 'TabsTrigger';

const TabsContent = forwardRefWithGenerics<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
      className
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName || 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
