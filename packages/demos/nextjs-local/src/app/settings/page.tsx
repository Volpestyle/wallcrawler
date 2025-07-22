'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Label,
  Switch,
} from '@/components/ui';

import { Save, RotateCcw, Monitor, Zap, Bell, Palette, Code } from 'lucide-react';

interface SettingsState {
  stagehand: {
    modelName: string;
    verbose: 0 | 1 | 2;
    enableCaching: boolean;
    domSettleTimeoutMs: number;
    selfHeal: boolean;
    experimental: boolean;
  };
  browser: {
    headless: boolean;
    viewport: {
      width: number;
      height: number;
    };
    userAgent: string;
    timeout: number;
  };
  ui: {
    theme: 'dark' | 'light' | 'system';
    fontSize: 'small' | 'medium' | 'large';
    showTooltips: boolean;
    autoRefresh: boolean;
  };
  notifications: {
    sessionStart: boolean;
    sessionEnd: boolean;
    errors: boolean;
    metrics: boolean;
  };
}

const defaultSettings: SettingsState = {
  stagehand: {
    modelName: 'gpt-4',
    verbose: 1,
    enableCaching: true,
    domSettleTimeoutMs: 10000,
    selfHeal: true,
    experimental: false,
  },
  browser: {
    headless: false,
    viewport: {
      width: 1280,
      height: 720,
    },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    timeout: 30000,
  },
  ui: {
    theme: 'dark',
    fontSize: 'medium',
    showTooltips: true,
    autoRefresh: true,
  },
  notifications: {
    sessionStart: true,
    sessionEnd: true,
    errors: true,
    metrics: false,
  },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const updateSetting = (section: keyof SettingsState, key: string, value: unknown) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }));
    setHasChanges(true);
  };

  const updateNestedSetting = (section: keyof SettingsState, nested: string, key: string, value: unknown) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [nested]: {
          ...((prev[section] as Record<string, unknown>)[nested] as Record<string, unknown>),
          [key]: value,
        },
      },
    }));
    setHasChanges(true);
  };

  const saveSettings = async () => {
    setSaving(true);
    // Simulate API call
    setTimeout(() => {
      localStorage.setItem('wallcrawler-settings', JSON.stringify(settings));
      setSaving(false);
      setHasChanges(false);
    }, 1000);
  };

  const resetSettings = () => {
    setSettings(defaultSettings);
    setHasChanges(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure Stagehand behavior and application preferences</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={resetSettings} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button onClick={saveSettings} disabled={!hasChanges || saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Stagehand Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4" />
            Stagehand Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="model-name">Model Name</Label>
              <Select
                value={settings.stagehand.modelName}
                onValueChange={(value) => updateSetting('stagehand', 'modelName', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4">GPT-4</SelectItem>
                  <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                  <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                  <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                  <SelectItem value="claude-3-sonnet">Claude 3 Sonnet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="verbose-level">Verbose Level</Label>
              <Select
                value={settings.stagehand.verbose.toString()}
                onValueChange={(value) => updateSetting('stagehand', 'verbose', parseInt(value) as 0 | 1 | 2)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select verbose level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 - No logs</SelectItem>
                  <SelectItem value="1">1 - Only errors</SelectItem>
                  <SelectItem value="2">2 - All logs</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dom-timeout">DOM Settle Timeout (ms)</Label>
              <Input
                id="dom-timeout"
                type="number"
                value={settings.stagehand.domSettleTimeoutMs}
                onChange={(e) => updateSetting('stagehand', 'domSettleTimeoutMs', parseInt(e.target.value))}
                min="1000"
                max="60000"
                step="1000"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="enable-caching">Enable Caching</Label>
                <Switch
                  id="enable-caching"
                  checked={settings.stagehand.enableCaching}
                  onCheckedChange={(checked) => updateSetting('stagehand', 'enableCaching', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="self-heal">Self Heal</Label>
                <Switch
                  id="self-heal"
                  checked={settings.stagehand.selfHeal}
                  onCheckedChange={(checked) => updateSetting('stagehand', 'selfHeal', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="experimental">Experimental Features</Label>
                <Switch
                  id="experimental"
                  checked={settings.stagehand.experimental}
                  onCheckedChange={(checked) => updateSetting('stagehand', 'experimental', checked)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Browser Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-4 w-4" />
            Browser Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="viewport-width">Viewport Width</Label>
              <Input
                id="viewport-width"
                type="number"
                value={settings.browser.viewport.width}
                onChange={(e) => updateNestedSetting('browser', 'viewport', 'width', parseInt(e.target.value))}
                min="800"
                max="3840"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="viewport-height">Viewport Height</Label>
              <Input
                id="viewport-height"
                type="number"
                value={settings.browser.viewport.height}
                onChange={(e) => updateNestedSetting('browser', 'viewport', 'height', parseInt(e.target.value))}
                min="600"
                max="2160"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Timeout (ms)</label>
              <input
                type="number"
                value={settings.browser.timeout}
                onChange={(e) => updateSetting('browser', 'timeout', parseInt(e.target.value))}
                className="w-full p-2 border rounded-md bg-background"
                min="5000"
                max="120000"
                step="5000"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Headless Mode</label>
                <input
                  type="checkbox"
                  checked={settings.browser.headless}
                  onChange={(e) => updateSetting('browser', 'headless', e.target.checked)}
                  className="w-4 h-4"
                />
              </div>
              <p className="text-xs text-muted-foreground">Run browser without GUI for better performance</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">User Agent</label>
            <input
              type="text"
              value={settings.browser.userAgent}
              onChange={(e) => updateSetting('browser', 'userAgent', e.target.value)}
              className="w-full p-2 border rounded-md bg-background font-mono text-xs"
              placeholder="Custom user agent string"
            />
          </div>
        </CardContent>
      </Card>

      {/* UI Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            UI Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Theme</label>
              <select
                value={settings.ui.theme}
                onChange={(e) => updateSetting('ui', 'theme', e.target.value)}
                className="w-full p-2 border rounded-md bg-background"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Font Size</label>
              <select
                value={settings.ui.fontSize}
                onChange={(e) => updateSetting('ui', 'fontSize', e.target.value)}
                className="w-full p-2 border rounded-md bg-background"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Show Tooltips</label>
                <input
                  type="checkbox"
                  checked={settings.ui.showTooltips}
                  onChange={(e) => updateSetting('ui', 'showTooltips', e.target.checked)}
                  className="w-4 h-4"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Auto Refresh Data</label>
                <input
                  type="checkbox"
                  checked={settings.ui.autoRefresh}
                  onChange={(e) => updateSetting('ui', 'autoRefresh', e.target.checked)}
                  className="w-4 h-4"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Session Start</label>
                <input
                  type="checkbox"
                  checked={settings.notifications.sessionStart}
                  onChange={(e) => updateSetting('notifications', 'sessionStart', e.target.checked)}
                  className="w-4 h-4"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Session End</label>
                <input
                  type="checkbox"
                  checked={settings.notifications.sessionEnd}
                  onChange={(e) => updateSetting('notifications', 'sessionEnd', e.target.checked)}
                  className="w-4 h-4"
                />
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Errors</label>
                <input
                  type="checkbox"
                  checked={settings.notifications.errors}
                  onChange={(e) => updateSetting('notifications', 'errors', e.target.checked)}
                  className="w-4 h-4"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Metrics Updates</label>
                <input
                  type="checkbox"
                  checked={settings.notifications.metrics}
                  onChange={(e) => updateSetting('notifications', 'metrics', e.target.checked)}
                  className="w-4 h-4"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-4 w-4" />
            Advanced Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 border rounded-lg bg-muted/50">
              <h4 className="font-semibold mb-2">Configuration Export</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Export your current settings as a JSON file for backup or sharing.
              </p>
              <Button variant="outline" size="sm">
                Export Settings
              </Button>
            </div>

            <div className="p-4 border rounded-lg bg-muted/50">
              <h4 className="font-semibold mb-2">Reset All Data</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Clear all sessions, workflows, and reset settings to defaults.
              </p>
              <Button variant="outline" size="sm" className="text-red-500 hover:text-red-400">
                Reset All Data
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
