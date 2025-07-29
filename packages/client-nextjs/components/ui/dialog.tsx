import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { 
  forwardRefWithGenerics, 
  createCompatibleComponent, 
  wrapRadixPrimitive,
  type WithChildren 
} from '@/lib/react19-compat';

const Dialog = createCompatibleComponent<WithChildren<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>>>(
  ({ children, ...props }) => (
    <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>
  ),
  'Dialog'
);

const DialogTrigger = wrapRadixPrimitive(DialogPrimitive.Trigger);

const DialogPortal = createCompatibleComponent<WithChildren<DialogPrimitive.DialogPortalProps>>(
  ({ children, ...props }) => (
    <DialogPrimitive.Portal {...props}>
      <div>{children}</div>
    </DialogPrimitive.Portal>
  ),
  'DialogPortal'
);

const DialogClose = wrapRadixPrimitive(DialogPrimitive.Close);

const DialogOverlay = forwardRefWithGenerics<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName || 'DialogOverlay';

const DialogContent = forwardRefWithGenerics<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  WithChildren<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-surface p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-surface data-[state=open]:text-text-secondary">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName || 'DialogContent';

const DialogHeader = createCompatibleComponent<React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }) => (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
  ),
  'DialogHeader'
);

const DialogFooter = createCompatibleComponent<React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }) => (
    <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
  ),
  'DialogFooter'
);

const DialogTitle = forwardRefWithGenerics<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName || 'DialogTitle';

const DialogDescription = forwardRefWithGenerics<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-text-secondary', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName || 'DialogDescription';

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
