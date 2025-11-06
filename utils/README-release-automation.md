# Release Automation Script

This directory contains a JavaScript-based release automation script that can be used both manually and via GitHub Actions workflows.

## Files

- `release-automation.js` - Main release automation script
- `.github/workflows/automated-release-script.yml` - Workflow that uses the script
- `.github/workflows/automated-release.yml` - Original inline shell-based workflow

## Usage

### Via GitHub Actions

1. Navigate to [Actions > Automated Release (Script-based)](https://github.com/FilOzone/synapse-sdk/actions/workflows/automated-release-script.yml)
2. Click **Run workflow**
3. Choose options:
   - Enable **dry run** to test without making changes
   - Adjust **timeout** if needed (default 600 seconds)
4. Click **Run workflow** button

### Manual Invocation

You can run the script manually from your local machine or a CI environment:

```bash
# Set GitHub token
export GITHUB_TOKEN=ghp_your_token_here

# Run with dry-run mode
node utils/release-automation.js --dry-run

# Run for real
node utils/release-automation.js

# Custom timeout (in seconds)
node utils/release-automation.js --timeout=900

# Show help
node utils/release-automation.js --help
```

## Requirements

- Node.js >= 22
- GitHub CLI (`gh`) installed
- `GITHUB_TOKEN` or `GH_TOKEN` environment variable set
- Git configured with user name and email

## How It Works

The script follows the same process as the shell-based workflow:

1. **Discovery**: Finds release-please PRs using `gh` CLI with label `autorelease: pending`
2. **Sequential Processing**: Processes packages in dependency order:
   - `synapse-core` (no dependencies)
   - `synapse-sdk` (depends on core)
   - `synapse-react` (depends on core and sdk)
3. **Conflict Resolution**: For dependent packages, automatically resolves conflicts:
   - Accepts incoming dependency versions from master
   - Preserves the package's own version from the PR
   - Keeps the PR's CHANGELOG.md
4. **Merge**: Uses squash merge to merge each PR
5. **Wait**: Polls the release-please workflow until completion
6. **Repeat**: Continues with next package

## Script Structure

```javascript
class ReleaseAutomation {
  async findReleasePRs()        // Find PRs by label and title
  getPRDetails(prNumber)         // Get PR info from GitHub
  mergePR(prNumber, name)        // Merge PR with squash
  async waitForWorkflow()        // Poll workflow status
  async resolveConflicts(...)    // Auto-resolve merge conflicts
  async run()                    // Main orchestration
}
```

## Advantages vs Inline Shell

### Script-based (`automated-release-script.yml`)

✅ Logic in separate, testable JavaScript file
✅ Can be invoked manually outside GitHub Actions
✅ Easier to unit test and validate locally
✅ More maintainable - standard JavaScript tooling
✅ Better error handling with try/catch
✅ Async/await for cleaner flow control
✅ Can be imported as a module

### Inline Shell (`automated-release.yml`)

✅ Everything in one YAML file
✅ No external script dependencies
✅ Slightly less abstraction
✅ Direct `gh` CLI usage visible in workflow

## Comparison

| Aspect | Script-based | Inline Shell |
|--------|-------------|--------------|
| Lines of code | ~370 JS + ~60 YAML | ~490 YAML |
| Testability | High | Low |
| Maintainability | High | Medium |
| Manual invocation | Easy | Hard |
| Debugging | Easy | Medium |
| Learning curve | Medium | Low |

## Testing

Since the script can be invoked manually, you can test it locally:

```bash
# Test help
node utils/release-automation.js --help

# Validate syntax
node --check utils/release-automation.js

# Test with dry-run (requires GITHUB_TOKEN)
export GITHUB_TOKEN=ghp_your_token
node utils/release-automation.js --dry-run
```

## Error Handling

The script provides clear error messages:

- ❌ Missing GITHUB_TOKEN
- ❌ No release PRs found
- ❌ Workflow timeout
- ❌ Workflow failed
- ❌ Merge conflicts couldn't be resolved

All errors are logged with emoji prefixes for easy scanning.

## Future Improvements

Potential enhancements:

- Add unit tests with mocked `gh` CLI
- Support for partial releases (specific packages only)
- Integration with Slack/email notifications
- Better timeout handling with exponential backoff
- Detailed release notes generation
- Rollback capability
