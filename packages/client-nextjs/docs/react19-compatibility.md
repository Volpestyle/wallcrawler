# React 19 Compatibility Solution

## Problem

React 19 has stricter JSX type requirements. Components can now return `Promise<ReactNode>`, but the JSX type system requires components to return synchronous `ReactNode` values. This causes TypeScript errors like:

```
'Dialog' cannot be used as a JSX component.
  Its type 'CompatibleComponent<WithChildren<DialogProps>>' is not a valid JSX element type.
```

## Solution

The solution involves updating the compatibility layer in `/packages/client-nextjs/lib/react19-compat.ts`:

### 1. Updated CompatibleComponent Type

```typescript
export type CompatibleComponent<P = {}> = ((props: P) => React.ReactNode) & {
  displayName?: string;
};
```

This ensures components return synchronous `ReactNode` values, which is required for JSX compatibility in React 19.

### 2. Enhanced createCompatibleComponent Function

```typescript
export function createCompatibleComponent<P extends Record<string, any>>(
  Component: React.ComponentType<P>,
  displayName?: string
): CompatibleComponent<P> {
  const CompatComponent = ((props: P): React.ReactNode => {
    return React.createElement(Component, props);
  }) as CompatibleComponent<P>;

  if (displayName) {
    CompatComponent.displayName = displayName;
  }

  return CompatComponent;
}
```

### 3. New wrapRadixPrimitive Utility

```typescript
export function wrapRadixPrimitive<P extends Record<string, any>>(
  Component: React.ComponentType<P>
): CompatibleComponent<P> {
  return createCompatibleComponent(Component, Component.displayName);
}
```

This utility specifically handles Radix UI primitive components that don't need additional wrapping logic.

## Applying the Fix

### For Regular Components

Use `createCompatibleComponent` for components that need children prop handling:

```typescript
const Dialog = createCompatibleComponent<WithChildren<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>>>(
  ({ children, ...props }) => (
    <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>
  ),
  'Dialog'
);
```

### For ForwardRef Components

Use `forwardRefWithGenerics` which already includes React 19 compatibility:

```typescript
const DialogContent = forwardRefWithGenerics<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  WithChildren<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>
>(({ className, children, ...props }, ref) => (
  // component implementation
));
```

### For Simple Primitive Wrappers

Use `wrapRadixPrimitive` for components that don't need additional logic:

```typescript
const DialogTrigger = wrapRadixPrimitive(DialogPrimitive.Trigger);
```

## Updated Components

The following UI components have been updated for React 19 compatibility:
- Dialog (dialog.tsx)
- Tabs (tabs.tsx)
- Select (select.tsx)
- Separator (separator.tsx)
- Toast (toast.tsx)
- Label (label.tsx)
- Button (button.tsx) - Already compatible
- Input (input.tsx) - Already compatible

## Key Points

1. All components now return synchronous `ReactNode` values
2. The solution maintains backward compatibility
3. Type safety is preserved without using `any` types
4. Display names are properly set for debugging
5. The approach works for both regular and forwardRef components