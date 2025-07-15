# Wallcrawler Logging Configuration

## Overview

Wallcrawler now supports saving application logs to files for easier debugging and analysis.

## Configuration

### Enable File Logging

Set the following environment variable in your `.env.local` file:

```bash
WALLCRAWLER_LOG_TO_FILE=true
```

### Disable File Logging

Remove the variable or set it to `false`:

```bash
WALLCRAWLER_LOG_TO_FILE=false
```

## Log Files Location

When enabled, logs are saved to the `./logs` directory:

```
logs/
├── wallcrawler.log          # General application logs
└── session-{sessionId}.log  # Session-specific logs
```

## Log File Structure

### General Log (`wallcrawler.log`)

Contains all application logs with timestamps:

```
2025-06-28T21:26:00.000Z [DEBUG] API Request - Type: navigate, SessionId: abc123, HasConfig: true
2025-06-28T21:26:01.000Z [abc123] [DEBUG] Navigating to: https://amazon.com
```

### Session-Specific Logs (`session-{sessionId}.log`)

Contains only logs for a specific workflow session:

```
2025-06-28T21:26:01.000Z [abc123] [DEBUG] Navigating to: https://amazon.com
2025-06-28T21:26:05.000Z [abc123] [DEBUG] Navigation complete, new URL: https://www.amazon.com/
2025-06-28T21:26:06.000Z [abc123] [DEBUG] Acting with instruction: Search for "wireless headphones"
```

## Usage

1. **Enable logging** by setting `WALLCRAWLER_LOG_TO_FILE=true` in `.env.local`
2. **Restart the development server**: `npm run dev`
3. **Run your workflows** as normal
4. **Check the logs** in the `./logs` directory

## Benefits

- **Easy debugging**: All logs saved to files for analysis
- **Session tracking**: Separate log files per workflow session
- **No copy-paste needed**: Direct file access for troubleshooting
- **Persistent logs**: Logs remain after browser console is cleared
- **Timestamps**: All logs include precise timestamps

## Example Workflow

```bash
# 1. Enable logging
echo "WALLCRAWLER_LOG_TO_FILE=true" >> .env.local

# 2. Restart server
npm run dev

# 3. Run E-commerce workflow
# (Use the UI to run the preset)

# 4. Check logs
cat logs/wallcrawler.log
# or for specific session:
cat logs/session-abc123-def456.log
```

## Notes

- Logs are appended to files (not overwritten)
- The `logs/` directory is created automatically when needed
- Both console output and file logging occur simultaneously
- Session IDs in log filenames use the full UUID format
