#!/usr/bin/env node

/**
 * Automated Release Script for Synapse SDK Monorepo
 *
 * This script automates the release process for packages in the monorepo:
 * 1. Finds release-please PRs by label and title pattern
 * 2. Merges them in dependency order (synapse-core → synapse-sdk → synapse-react)
 * 3. Waits for release-please workflow to complete after each merge
 * 4. Automatically resolves merge conflicts for dependent packages
 *
 * Usage:
 *   node utils/release-automation.js [--dry-run] [--timeout=600]
 *
 * Environment:
 *   GITHUB_TOKEN - GitHub personal access token (required)
 *
 * Options:
 *   --dry-run       Show what would be done without making changes
 *   --timeout=N     Timeout for waiting for workflows in seconds (default: 600)
 *   --help          Show this help message
 */

import { execSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const RELEASE_LABEL = 'autorelease: pending'
const WORKFLOW_NAME = 'release-please.yml'
const PACKAGES = [
	{ name: 'synapse-core', path: 'packages/synapse-core' },
	{ name: 'synapse-sdk', path: 'packages/synapse-sdk' },
	{ name: 'synapse-react', path: 'packages/synapse-react' },
]

class ReleaseAutomation {
	constructor(options = {}) {
		this.dryRun = options.dryRun || false
		this.timeout = options.timeout || 600
		this.token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN

		if (!this.token) {
			throw new Error('GITHUB_TOKEN or GH_TOKEN environment variable is required')
		}
	}

	log(emoji, message) {
		console.log(`${emoji} ${message}`)
	}

	error(message) {
		console.error(`❌ ${message}`)
	}

	/**
	 * Execute a command and return stdout
	 */
	exec(command, options = {}) {
		try {
			return execSync(command, {
				encoding: 'utf8',
				stdio: options.silent ? 'pipe' : 'inherit',
				env: { ...process.env, GH_TOKEN: this.token },
				...options,
			})
		} catch (error) {
			if (!options.ignoreError) {
				throw error
			}
			return null
		}
	}

	/**
	 * Find release PRs using GitHub CLI
	 */
	async findReleasePRs() {
		this.log('🔍', 'Searching for release-please PRs...')

		const prs = {}

		for (const pkg of PACKAGES) {
			const pattern = `release ${pkg.name}`
			const result = this.exec(
				`gh pr list --label "${RELEASE_LABEL}" --json number,title,headRefName --jq '.[] | select(.title | test("${pattern}"; "i")) | .number'`,
				{ silent: true },
			)

			const prNumber = result?.trim()
			if (prNumber) {
				prs[pkg.name] = Number.parseInt(prNumber, 10)
				this.log('  📦', `${pkg.name}: PR #${prNumber}`)
			} else {
				this.log('  ⏭️ ', `${pkg.name}: No release PR found`)
			}
		}

		return prs
	}

	/**
	 * Get PR details
	 */
	getPRDetails(prNumber) {
		const result = this.exec(
			`gh pr view ${prNumber} --json headRefName,title,mergeable`,
			{ silent: true },
		)
		return JSON.parse(result)
	}

	/**
	 * Merge a PR using squash merge
	 */
	mergePR(prNumber, packageName) {
		this.log('🔀', `Merging ${packageName} PR #${prNumber}...`)

		if (this.dryRun) {
			this.log('🔍', 'DRY RUN: Would merge PR')
			return
		}

		this.exec(`gh pr merge ${prNumber} --squash --auto=false --delete-branch`)
		this.log('✅', `Merged ${packageName} PR #${prNumber}`)
	}

	/**
	 * Wait for release-please workflow to complete
	 */
	async waitForWorkflow() {
		this.log('⏳', 'Waiting for release-please workflow to complete...')

		if (this.dryRun) {
			this.log('🔍', 'DRY RUN: Would wait for workflow')
			return
		}

		// Wait a bit for the workflow to start
		await this.sleep(30000)

		const startTime = Date.now()
		const timeoutMs = this.timeout * 1000
		const interval = 15000

		while (Date.now() - startTime < timeoutMs) {
			const result = this.exec(
				`gh run list --workflow=${WORKFLOW_NAME} --limit=1 --json status,conclusion`,
				{ silent: true },
			)

			const runs = JSON.parse(result)
			if (runs.length > 0) {
				const run = runs[0]
				this.log('  📊', `Status: ${run.status}, Conclusion: ${run.conclusion || 'N/A'}`)

				if (run.status === 'completed') {
					if (run.conclusion === 'success') {
						this.log('✅', 'Release workflow completed successfully')
						return
					}
					throw new Error(`Release workflow failed with conclusion: ${run.conclusion}`)
				}
			}

			await this.sleep(interval)
		}

		throw new Error('Timeout waiting for release workflow')
	}

	/**
	 * Resolve merge conflicts for a package
	 */
	async resolveConflicts(prNumber, packageName, packagePath) {
		this.log('🔧', `Checking conflicts for ${packageName} PR #${prNumber}...`)

		const prDetails = this.getPRDetails(prNumber)

		if (prDetails.mergeable !== 'CONFLICTING') {
			this.log('  ✨', 'No conflicts to resolve')
			return
		}

		if (this.dryRun) {
			this.log('🔍', 'DRY RUN: Would resolve conflicts')
			return
		}

		this.log('⚠️ ', 'PR has conflicts, resolving...')

		const prBranch = prDetails.headRefName

		// Fetch and checkout PR branch
		this.exec(`git fetch origin ${prBranch}`)
		this.exec(`git checkout ${prBranch}`)

		// Get current version before merge
		const packageJsonPath = resolve(packagePath, 'package.json')
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
		const currentVersion = packageJson.version
		this.log('  📌', `Current ${packageName} version: ${currentVersion}`)

		// Merge master
		this.exec('git fetch origin master')
		const mergeResult = this.exec('git merge origin/master --no-edit', {
			ignoreError: true,
		})

		if (mergeResult === null) {
			this.log('  🔨', 'Merge conflicts detected, resolving...')

			// Resolve package.json conflicts
			this.exec(`git checkout --theirs ${packageJsonPath}`)
			const updatedPackageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
			updatedPackageJson.version = currentVersion
			writeFileSync(packageJsonPath, `${JSON.stringify(updatedPackageJson, null, 2)}\n`)
			this.exec(`git add ${packageJsonPath}`)

			// Resolve pnpm-lock.yaml
			const lockStatus = this.exec('git ls-files -u pnpm-lock.yaml', {
				silent: true,
				ignoreError: true,
			})
			if (lockStatus?.trim()) {
				this.exec('git checkout --theirs pnpm-lock.yaml')
				this.exec('git add pnpm-lock.yaml')
			}

			// Resolve release-please-manifest.json
			const manifestPath = '.github/release-please-manifest.json'
			const manifestStatus = this.exec(`git ls-files -u ${manifestPath}`, {
				silent: true,
				ignoreError: true,
			})
			if (manifestStatus?.trim()) {
				this.exec(`git checkout --theirs ${manifestPath}`)
				const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
				manifest[packagePath] = currentVersion
				writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
				this.exec(`git add ${manifestPath}`)
			}

			// Resolve CHANGELOG.md (keep ours)
			const changelogPath = resolve(packagePath, 'CHANGELOG.md')
			const changelogStatus = this.exec(`git ls-files -u ${changelogPath}`, {
				silent: true,
				ignoreError: true,
			})
			if (changelogStatus?.trim()) {
				this.exec(`git checkout --ours ${changelogPath}`)
				this.exec(`git add ${changelogPath}`)
			}

			// Commit the merge
			this.exec('git commit --no-edit')

			// Push resolved conflicts
			this.exec(`git push origin ${prBranch}`)

			this.log('✅', 'Conflicts resolved and pushed')
		} else {
			this.log('  ✨', 'No conflicts after merge')
		}

		// Return to master
		this.exec('git checkout master')
	}

	/**
	 * Sleep utility
	 */
	sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}

	/**
	 * Main release process
	 */
	async run() {
		try {
			this.log('🚀', 'Starting automated release process...')

			if (this.dryRun) {
				this.log('🔍', 'DRY RUN MODE - No changes will be made')
			}

			// Find release PRs
			const prs = await this.findReleasePRs()

			if (Object.keys(prs).length === 0) {
				this.error('No release PRs found. Nothing to release.')
				process.exit(1)
			}

			// Process packages in order
			for (const pkg of PACKAGES) {
				const prNumber = prs[pkg.name]
				if (!prNumber) {
					this.log('⏭️ ', `Skipping ${pkg.name} (no release PR)`)
					continue
				}

				this.log('📦', `Processing ${pkg.name} release (PR #${prNumber})...`)

				// Resolve conflicts if this package depends on previous ones
				const pkgIndex = PACKAGES.findIndex((p) => p.name === pkg.name)
				if (pkgIndex > 0) {
					const hasPreviousRelease = PACKAGES.slice(0, pkgIndex).some(
						(p) => prs[p.name],
					)
					if (hasPreviousRelease) {
						await this.resolveConflicts(prNumber, pkg.name, pkg.path)
					}
				}

				// Merge PR
				this.mergePR(prNumber, pkg.name)

				// Wait for workflow
				await this.waitForWorkflow()
			}

			// Summary
			this.log('', '\n📊 Release Summary')
			for (const pkg of PACKAGES) {
				const prNumber = prs[pkg.name]
				if (prNumber) {
					this.log('✅', `${pkg.name} (PR #${prNumber})`)
				} else {
					this.log('⏭️ ', `${pkg.name} (skipped - no release PR)`)
				}
			}

			this.log('🎉', 'Automated release process completed!')
		} catch (error) {
			this.error(`Release process failed: ${error.message}`)
			throw error
		}
	}
}

// CLI entry point
async function main() {
	const args = process.argv.slice(2)

	if (args.includes('--help') || args.includes('-h')) {
		console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].slice(3))
		process.exit(0)
	}

	const options = {
		dryRun: args.includes('--dry-run'),
		timeout: 600,
	}

	// Parse timeout
	const timeoutArg = args.find((arg) => arg.startsWith('--timeout='))
	if (timeoutArg) {
		options.timeout = Number.parseInt(timeoutArg.split('=')[1], 10)
	}

	const automation = new ReleaseAutomation(options)
	await automation.run()
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error)
		process.exit(1)
	})
}

export { ReleaseAutomation }
