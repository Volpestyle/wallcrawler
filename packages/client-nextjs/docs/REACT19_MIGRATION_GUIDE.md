# React 19 Migration Guide for Shadcn UI Components

## Overview

This guide addresses the type compatibility issues between React 19 and Radix UI primitives used in Shadcn UI components. The main issues stem from stricter type requirements in React 19, particularly around:

1. **ReactNode type changes**
2. **ForwardRef component type strictness**
3. **Children prop handling in portals**
4. **JSX element type validation**

## Root Cause Analysis

### 1. ReactNode Type Changes
React 19 has stricter definitions for `ReactNode`, which affects how children props are typed. The `ReactPortal` type now requires explicit children definitions.

### 2. ForwardRef Type Incompatibility
The standard `React.forwardRef` doesn't always produce components that satisfy React 19's stricter JSX element type requirements, especially when used with complex generic types.

### 3. Portal Children Issues
Radix UI portals (Dialog, Popover, etc.) don't explicitly type their children prop, causing React 19 to complain about missing properties.

## Solution Architecture

### 1. React 19 Compatibility Layer (`lib/react19-compat.ts`)

We've created a compatibility layer that provides:

- **`forwardRefWithGenerics`**: Enhanced forwardRef that ensures proper typing
- **`createCompatibleComponent`**: Wrapper for creating React 19 compatible components
- **`WithChildren`**: Type helper for components with children
- **`ensureValidProps`**: Props validation utility

### 2. Type Augmentations (`types/radix-ui-react19.d.ts`)

Type declaration file that augments Radix UI component types to include proper children definitions for portal components.

### 3. Component Updates

All Shadcn UI components are updated to use the compatibility layer:

```typescript
// Before (causes React 19 errors)
const Component = React.forwardRef<HTMLElement, Props>((props, ref) => {
  // component implementation
});

// After (React 19 compatible)
const Component = forwardRefWithGenerics<HTMLElement, Props>((props, ref) => {
  // component implementation
});
```

## Best Practices for React 19 + Next.js 15

### 1. Always Use the Compatibility Layer

When creating new components with forwardRef:

```typescript
import { forwardRefWithGenerics } from '@/lib/react19-compat';

const MyComponent = forwardRefWithGenerics<HTMLDivElement, MyProps>(
  ({ children, ...props }, ref) => {
    return <div ref={ref} {...props}>{children}</div>;
  }
);
```

### 2. Explicit Children Types

Always explicitly type children in component props:

```typescript
interface MyComponentProps {
  children?: React.ReactNode;
  // other props
}
```

### 3. Portal Components

For components using portals, wrap the children in a div to ensure proper rendering:

```typescript
const MyPortal = createCompatibleComponent<WithChildren<PortalProps>>(
  ({ children, ...props }) => (
    <Portal {...props}>
      <div>{children}</div>
    </Portal>
  ),
  'MyPortal'
);
```

### 4. TypeScript Configuration

Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true
  }
}
```

### 5. Component Architecture Patterns

#### Server Components by Default
```typescript
// app/components/server-component.tsx
export default function ServerComponent({ data }: Props) {
  // No 'use client' directive - runs on server
  return <div>{data}</div>;
}
```

#### Client Components When Needed
```typescript
// app/components/client-component.tsx
'use client';

import { useState } from 'react';

export default function ClientComponent() {
  const [state, setState] = useState();
  // Interactive component
}
```

### 6. Performance Optimization

#### Use React 19's `use()` Hook
```typescript
import { use } from 'react';

function Component({ promise }: { promise: Promise<Data> }) {
  const data = use(promise);
  return <div>{data}</div>;
}
```

#### Implement Proper Suspense Boundaries
```typescript
<Suspense fallback={<Loading />}>
  <AsyncComponent />
</Suspense>
```

## Migration Checklist

- [ ] Update all `React.forwardRef` to `forwardRefWithGenerics`
- [ ] Add type augmentations for Radix UI components
- [ ] Update TypeScript configuration
- [ ] Wrap portal children in container elements
- [ ] Test all dialog, popover, and dropdown components
- [ ] Verify build passes without type errors
- [ ] Check runtime behavior in development and production

## Configuration Updates

### Required Dependencies

Ensure your `package.json` has compatible versions:

```json
{
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "next": "^15.4.4",
    "@radix-ui/react-dialog": "^1.1.14"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

## Troubleshooting

### Issue: "Component cannot be used as a JSX component"
**Solution**: Use `forwardRefWithGenerics` instead of `React.forwardRef`

### Issue: "Property 'children' is missing in type 'ReactPortal'"
**Solution**: Add type augmentation for the portal component or wrap children in a div

### Issue: Type errors with third-party components
**Solution**: Create wrapper components using `createCompatibleComponent`

## Future Considerations

As Radix UI and other libraries update for React 19 compatibility, you can gradually remove the compatibility layer. Monitor:

1. Radix UI releases for React 19 support
2. Next.js updates for improved React 19 integration
3. TypeScript improvements for React type inference

The compatibility layer is designed to be easily removable once native support is available.