import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { forwardRefWithGenerics } from '@/lib/react19-compat';

const labelVariants = cva('text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70');

const Label = forwardRefWithGenerics<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName || 'Label';

export { Label };
