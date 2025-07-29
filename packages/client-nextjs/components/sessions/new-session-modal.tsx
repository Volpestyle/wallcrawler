'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Cloud, Server } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSessionStore } from '@/lib/stores/session-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const localFormSchema = z.object({
  url: z.string().url('Please enter a valid URL'),
  name: z.string().min(1, 'Session name is required'),
});

const wallcrawlerFormSchema = z.object({
  name: z.string().min(1, 'Session name is required'),
});

type LocalFormData = z.infer<typeof localFormSchema>;
type WallcrawlerFormData = z.infer<typeof wallcrawlerFormSchema>;

export function NewSessionModal() {
  const [isCreating, setIsCreating] = useState(false);
  const [sessionType, setSessionType] = useState<'local' | 'wallcrawler'>('wallcrawler');
  const { addSession, setUseWallcrawler, initializeWallcrawler } = useSessionStore();
  const { sessionModalOpen, setSessionModalOpen } = useUIStore();
  const [hasWallcrawlerConfig, setHasWallcrawlerConfig] = useState(false);

  useEffect(() => {
    // Check if Wallcrawler environment variables are set
    const apiKey = process.env.NEXT_PUBLIC_WALLCRAWLER_API_KEY;
    const projectId = process.env.NEXT_PUBLIC_WALLCRAWLER_PROJECT_ID;
    setHasWallcrawlerConfig(!!(apiKey && projectId));

    // Initialize Wallcrawler if config is available
    if (apiKey && projectId) {
      initializeWallcrawler();
    }
  }, [initializeWallcrawler]);

  const localForm = useForm<LocalFormData>({
    resolver: zodResolver(localFormSchema),
    defaultValues: {
      url: 'http://localhost:3000',
      name: '',
    },
  });

  const wallcrawlerForm = useForm<WallcrawlerFormData>({
    resolver: zodResolver(wallcrawlerFormSchema),
    defaultValues: {
      name: '',
    },
  });

  const onSubmitLocal = async (data: LocalFormData) => {
    setIsCreating(true);
    try {
      setUseWallcrawler(false);
      const session = await addSession(data.url, data.name);
      if (session) {
        localForm.reset();
        setSessionModalOpen(false);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const onSubmitWallcrawler = async (data: WallcrawlerFormData) => {
    setIsCreating(true);
    try {
      setUseWallcrawler(true);
      const session = await addSession('', data.name); // URL not needed for Wallcrawler
      if (session) {
        wallcrawlerForm.reset();
        setSessionModalOpen(false);
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={sessionModalOpen} onOpenChange={setSessionModalOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Session</DialogTitle>
          <DialogDescription>Choose how to connect your browser automation session</DialogDescription>
        </DialogHeader>

        <Tabs
          value={sessionType}
          onValueChange={(v) => setSessionType(v as 'local' | 'wallcrawler')}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="wallcrawler" disabled={!hasWallcrawlerConfig}>
              <Cloud className="mr-2 h-4 w-4" />
              Wallcrawler
            </TabsTrigger>
            <TabsTrigger value="local">
              <Server className="mr-2 h-4 w-4" />
              Local
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wallcrawler">
            {!hasWallcrawlerConfig ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                <p>Wallcrawler configuration not found.</p>
                <p className="mt-2">Please set the following environment variables:</p>
                <code className="block mt-2 text-xs">NEXT_PUBLIC_WALLCRAWLER_API_KEY</code>
                <code className="block text-xs">NEXT_PUBLIC_WALLCRAWLER_PROJECT_ID</code>
              </div>
            ) : (
              <form onSubmit={wallcrawlerForm.handleSubmit(onSubmitWallcrawler)}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="wallcrawler-name">Session Name</Label>
                    <Input
                      id="wallcrawler-name"
                      placeholder="My Cloud Session"
                      {...wallcrawlerForm.register('name')}
                      disabled={isCreating}
                    />
                    {wallcrawlerForm.formState.errors.name && (
                      <p className="text-xs text-error">{wallcrawlerForm.formState.errors.name.message}</p>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Sessions will be created in AWS infrastructure with automatic scaling and management.
                  </p>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSessionModalOpen(false)}
                    disabled={isCreating}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isCreating}>
                    {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Cloud Session
                  </Button>
                </DialogFooter>
              </form>
            )}
          </TabsContent>

          <TabsContent value="local">
            <form onSubmit={localForm.handleSubmit(onSubmitLocal)}>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="local-url">Stagehand URL</Label>
                  <Input
                    id="local-url"
                    placeholder="http://localhost:3000"
                    {...localForm.register('url')}
                    disabled={isCreating}
                  />
                  {localForm.formState.errors.url && (
                    <p className="text-xs text-error">{localForm.formState.errors.url.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="local-name">Session Name</Label>
                  <Input
                    id="local-name"
                    placeholder="My Local Session"
                    {...localForm.register('name')}
                    disabled={isCreating}
                  />
                  {localForm.formState.errors.name && (
                    <p className="text-xs text-error">{localForm.formState.errors.name.message}</p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setSessionModalOpen(false)}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isCreating}>
                  {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Create Local Session
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
