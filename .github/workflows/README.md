# GitHub Actions Workflows

This directory contains automated workflows for CI/CD.

## Active Workflows

### 1. Test Workflow (`test.yml`)
- **Trigger**: On pull requests to `main`
- **Purpose**: Run tests and build to ensure code quality
- **Steps**:
  1. Checkout code
  2. Setup Node.js 20
  3. Install dependencies
  4. Run tests
  5. Build project

### 2. Release Workflow (`release.yml`)
- **Trigger**: On push to `main` branch (excluding test files)
- **Purpose**: Automatically test, bump version, and publish to npm
- **Features**:
  - Runs tests before release
  - Automatically bumps patch version
  - Publishes to npm
  - Pushes version commit and tag back to GitHub
  - Uses GH_PAT for authentication
- **Skip**: Add `[skip ci]` to commit message to skip

## Required Secrets

To use these workflows, you need to configure the following secrets in your GitHub repository settings:

1. **`NPM_TOKEN`** (Required)
   - Get from npm: `npm token create`
   - Add to GitHub: Settings → Secrets → Actions → New repository secret
   - This allows automated publishing to npm

2. **`GH_PAT`** (Optional but recommended)
   - Personal Access Token with `repo` scope
   - Allows the workflow to push version bumps back to the repository
   - Without this, the workflow will use the default `GITHUB_TOKEN` which may have limitations

## How It Works

1. When you push to `main`, tests run automatically
2. If tests pass, the version is automatically bumped (patch version)
3. The new version is built and published to npm
4. The version change is committed back to the repository with `[skip ci]` to avoid infinite loops

## Preventing Infinite Loops

The workflow includes safeguards:
- Commits with `[skip ci]` in the message are ignored
- Version bump commits start with `chore(release):` and are skipped
- The workflow checks the last commit message before proceeding

## Manual Version Control

If you need to control versioning manually:
- Create a commit with `[skip ci]` in the message
- Or temporarily disable the workflow in GitHub Actions settings