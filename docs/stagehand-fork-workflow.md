# Stagehand Fork Workflow

This document explains how to work with the forked Stagehand repository as a submodule within the Wallcrawler monorepo.

## Overview

The `packages/stagehand` directory is a git submodule that points to our fork of the Stagehand library at `https://github.com/Volpestyle/stagehand.git`. This allows us to make custom modifications while staying in sync with upstream changes.

## Repository Structure

```
wallcrawler/                     # Main monorepo
├── packages/stagehand/          # Git submodule (our fork)
│   ├── .git -> points to Volpestyle/stagehand
│   └── ...stagehand files
└── ...other wallcrawler files
```

## Remote Configuration

The stagehand submodule has two remotes:

- `origin`: Our fork (`https://github.com/Volpestyle/stagehand.git`)
- `upstream`: Original repository (`https://github.com/browserbase/stagehand.git`)

## Daily Workflow

### Making Changes to Stagehand

1. **Navigate to the submodule directory:**

   ```bash
   cd packages/stagehand
   ```

2. **Make your code changes** using your preferred editor

3. **Commit your changes** with conventional commit messages:

   ```bash
   git add .
   git commit -m "feat: your new feature description"
   # or
   git commit -m "fix: bug fix description"
   # or
   git commit -m "chore: maintenance task description"
   ```

4. **Push to your fork:**

   ```bash
   git push origin main
   ```

### Updating Main Repository Reference (Always Required)

If you want the main wallcrawler repository to track your latest changes:

1. **Return to main repository:**

   ```bash
   cd ../..  # Back to wallcrawler root
   ```

2. **Stage the submodule update:**

   ```bash
   git add packages/stagehand
   ```

3. **Commit the reference update:**

   ```bash
   git commit -m "chore: update stagehand submodule to latest"
   ```

4. **Push to wallcrawler repository:**
   ```bash
   git push origin main
   ```

## Syncing with Upstream

When the original Stagehand repository gets updates:

1. **Navigate to submodule:**

   ```bash
   cd packages/stagehand
   ```

2. **Fetch upstream changes:**

   ```bash
   git fetch upstream
   ```

3. **Rebase your changes on top of upstream:**

   ```bash
   git rebase upstream/main
   ```

4. **Force push to your fork** (use `--force-with-lease` for safety):

   ```bash
   git push --force-with-lease origin main
   ```

5. **Update main repository reference**:
   ```bash
   cd ../..
   git add packages/stagehand
   git commit -m "chore: sync stagehand with upstream"
   git push origin main
   ```

## Useful Commands

### Status Checks

```bash
# From wallcrawler root - check submodule status
git submodule status

# From wallcrawler root - see what commit submodule points to
cd packages/stagehand && git log --oneline -1

# Check remote configuration
cd packages/stagehand && git remote -v
```

### Branch Management

```bash
# Create a feature branch in the submodule
cd packages/stagehand
git checkout -b feature/my-new-feature
git push -u origin feature/my-new-feature
```

## Troubleshooting

### Submodule Out of Sync

If the submodule seems out of sync:

```bash
# Update submodule to match what main repo expects
git submodule update --remote packages/stagehand

# Or initialize if it's empty
git submodule update --init --recursive
```

### Merge Conflicts During Rebase

If you encounter conflicts when syncing with upstream:

1. Resolve conflicts in affected files
2. Stage resolved files: `git add <file>`
3. Continue rebase: `git rebase --continue`
4. Force push: `git push --force-with-lease origin main`

## Best Practices

1. **Always work in the submodule directory** (`packages/stagehand`) when making Stagehand changes
2. **Use `--force-with-lease`** instead of `--force` when force pushing
3. **Keep your fork synced** with upstream regularly
4. **Update main repo reference** when you want other team members to use your latest changes

## Example Complete Workflow

Here's a complete example of adding a new feature:

```bash
# 1. Go to submodule and create feature branch
cd packages/stagehand
git checkout -b feature/new-browser-provider

# 2. Make code changes...
# Edit files, add features, etc.

# 3. Commit with conventional message
git add .
git commit -m "feat: add new browser provider for XYZ platform"

# 4. Push feature branch to fork
git push -u origin feature/new-browser-provider

# 5. Merge to main (via PR or direct merge)
git checkout main
git merge feature/new-browser-provider
git push origin main

# 6. Update main wallcrawler repo reference
cd ../..
git add packages/stagehand
git commit -m "chore: update stagehand with new browser provider"
git push origin main

# 7. Clean up feature branch
cd packages/stagehand
git branch -d feature/new-browser-provider
git push origin --delete feature/new-browser-provider
```

## Submodule-Specific Considerations

### Team Member Setup

**First-time clone:**

```bash
git clone --recursive https://github.com/Volpestyle/wallcrawler.git
# OR
git clone https://github.com/Volpestyle/wallcrawler.git
cd wallcrawler
git submodule update --init --recursive
```

**Pulling updates:**

```bash
git pull --recurse-submodules
# OR
git pull && git submodule update --recursive
```

### Submodule Status Indicators

```bash
git submodule status
# " hash..." = Clean, matches main repo expectation
# "+hash..." = Submodule has uncommitted changes
# "-hash..." = Submodule is on different commit than expected
# "Uhash..." = Submodule has merge conflicts
```

### Common Submodule Issues

**Problem**: Team member gets "submodule not found" errors
**Solution**: `git submodule update --init --recursive`

**Problem**: Submodule shows as modified after pull
**Solution**: `git submodule update --recursive`

**Problem**: Working in detached HEAD in submodule
**Solution**: `cd packages/stagehand && git checkout main`

## Current Status

✅ **Latest commit successfully pushed:** `0eab048 - feat: add browser provider abstraction system and WallcrawlerAPI`

✅ **Submodule setup verified:** Main repository correctly references the latest commit

The workflow has been properly completed for the recent browser provider abstraction feature.
