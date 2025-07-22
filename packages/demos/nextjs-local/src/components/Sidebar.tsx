'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { LayoutDashboard, MonitorSpeaker, Workflow, FlaskConical, Settings, Activity } from 'lucide-react';

const sidebarItems = [
  {
    title: 'Dashboard',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    title: 'Sessions',
    href: '/sessions',
    icon: MonitorSpeaker,
  },
  {
    title: 'Workflows',
    href: '/workflows',
    icon: Workflow,
  },
  {
    title: 'Playground',
    href: '/playground',
    icon: FlaskConical,
  },
  {
    title: 'Metrics',
    href: '/metrics',
    icon: Activity,
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="w-64 bg-card border-r border-border flex flex-col">
      <div className="p-6">
        <h1 className="text-lg font-bold text-foreground">Wallcrawler Demo</h1>
        <p className="text-sm text-muted-foreground">Local Automation</p>
      </div>

      <nav className="flex-1 px-4 pb-4">
        <ul className="space-y-2">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <li key={item.href}>
                <Link href={item.href}>
                  <Button
                    variant={isActive ? 'secondary' : 'ghost'}
                    className={cn(
                      'w-full justify-start gap-3 h-10',
                      isActive && 'bg-secondary text-secondary-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.title}
                  </Button>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-border">
        <p className="text-xs text-muted-foreground">v0.1.0 • Local Mode</p>
      </div>
    </div>
  );
}
