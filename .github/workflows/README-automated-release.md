# Automated Release Workflow

This workflow automates the release process for all packages in the monorepo.

## Overview

The `automated-release.yml` workflow handles:
1. Finding all release-please PRs
2. Merging them in the correct dependency order
3. Waiting for each release to complete
4. Automatically resolving merge conflicts
5. Providing detailed logging for audit

## Usage

### Basic Usage

1. Navigate to [Actions > Automated Release](https://github.com/FilOzone/synapse-sdk/actions/workflows/automated-release.yml)
2. Click **Run workflow**
3. Select branch (usually `master`)
4. Click **Run workflow** button

### Dry Run Mode

For testing or verification, use dry-run mode:

1. Navigate to the workflow
2. Click **Run workflow**
3. Check the **Dry run mode** checkbox
4. Click **Run workflow** button

Dry-run mode will:
- Find all release PRs
- Show what would be merged
- NOT actually merge anything
- NOT trigger releases

## How It Works

### 1. Discovery Phase

The workflow searches for release-please PRs with the label `autorelease: pending`:
- Looks for PRs containing "synapse-core"
- Looks for PRs containing "synapse-sdk" (but not core or react)
- Looks for PRs containing "synapse-react"

### 2. Validation Phase

Ensures at least one release PR exists before proceeding.

### 3. Release Phase

Processes packages in dependency order:

**synapse-core** (base package):
- Merges PR with squash merge
- Waits for release-please workflow to complete
- Publishes to npm

**synapse-sdk** (depends on synapse-core):
- Checks for merge conflicts
- If conflicts exist:
  - Fetches the PR branch
  - Merges master into the branch
  - Resolves conflicts by accepting incoming dependency versions
  - Preserves the synapse-sdk version from the PR
  - Pushes resolved changes back to the PR
- Merges PR with squash merge
- Waits for release-please workflow to complete
- Publishes to npm

**synapse-react** (depends on synapse-core and synapse-sdk):
- Same conflict resolution as synapse-sdk
- Merges PR with squash merge
- Waits for release-please workflow to complete
- Publishes to npm

### 4. Summary Phase

Reports which packages were processed and their outcomes.

## Conflict Resolution

When a package depends on another (e.g., synapse-sdk depends on synapse-core), merging the first package's release will update the dependency version in `master`. This creates conflicts with the second package's release PR.

The workflow automatically resolves these conflicts by:
1. Checking if the PR has conflicts
2. Checking out the PR branch locally
3. Merging master into the branch
4. For conflicting files:
   - `package.json`: Accept incoming dependency versions, preserve PR version
   - `pnpm-lock.yaml`: Accept incoming (updated lockfile)
   - `.github/release-please-manifest.json`: Accept incoming, restore PR version
5. Pushing the resolved changes back to the PR branch

This matches the manual process documented in CONTRIBUTING.md.

## Error Handling

The workflow will fail and stop if:
- No release PRs are found
- A PR merge fails
- A release-please workflow fails
- A release-please workflow times out (10 minutes)
- Conflict resolution fails

When a failure occurs:
- The workflow logs will show the exact error
- No further packages will be processed
- Already-merged packages will have been released

## Monitoring

During execution, the workflow provides detailed logs:
- 🔍 for search/discovery operations
- ✅ for successful operations
- ⚠️ for warnings/conflicts
- ❌ for errors
- ⏳ for waiting operations
- 📦 for package processing
- 🔀 for merge operations
- 🔧 for conflict resolution

## Permissions

The workflow requires:
- `contents: write` - To merge PRs and push conflict resolutions
- `pull-requests: write` - To merge and update PRs
- `actions: read` - To monitor release-please workflow status

## Troubleshooting

### "No release PRs found"

Check that:
- Release PRs have been created by release-please
- PRs have the `autorelease: pending` label
- PR titles contain the expected package names

### "Timeout waiting for release workflow"

The release-please workflow is taking longer than 10 minutes. This could be due to:
- npm publishing issues
- CI/CD problems
- Network issues

Check the [release-please workflow runs](https://github.com/FilOzone/synapse-sdk/actions/workflows/release-please.yml) for details.

### "Merge conflict resolution failed"

The automatic conflict resolution couldn't handle the conflicts. You may need to:
1. Manually resolve the conflicts following CONTRIBUTING.md
2. Re-run the workflow

### "PR merge failed"

The PR couldn't be merged. Check:
- PR is still open
- PR has no unresolved conflicts
- Branch protection rules are satisfied
- CI checks have passed

## Comparison to Manual Process

| Aspect | Manual | Automated |
|--------|--------|-----------|
| Find PRs | Manual search | Automatic discovery |
| Merge order | Human ensures correct order | Enforced by workflow |
| Wait for completion | Human monitors | Automatic polling |
| Conflict resolution | Manual git operations | Automatic resolution |
| Time required | 15-30 minutes | 5-10 minutes |
| Human intervention | Multiple points | Start only |
| Error prone | Moderate | Low |
| Audit trail | Limited | Full workflow logs |

## Future Improvements

Potential enhancements:
- Add Slack/email notifications on completion
- Support for partial releases (specific packages only)
- Better timeout handling for slow releases
- Integration with release checklist/documentation
