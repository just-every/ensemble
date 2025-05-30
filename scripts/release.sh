#!/bin/bash

# Release script for @just-every/ensemble
# Usage: ./scripts/release.sh [patch|minor|major|version]

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get the version bump type (default to patch)
VERSION_TYPE=${1:-patch}

echo -e "${YELLOW}🚀 Starting release process for @just-every/ensemble${NC}"

# Ensure we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo -e "${RED}Error: You must be on the main branch to release${NC}"
    exit 1
fi

# Ensure working directory is clean
if ! git diff-index --quiet HEAD --; then
    echo -e "${RED}Error: Working directory is not clean. Please commit or stash changes.${NC}"
    exit 1
fi

# Pull latest changes
echo -e "${GREEN}Pulling latest changes...${NC}"
git pull origin main

# Run tests
echo -e "${GREEN}Running tests...${NC}"
npm test

# Build the package
echo -e "${GREEN}Building package...${NC}"
npm run build

# Bump version
echo -e "${GREEN}Bumping version (${VERSION_TYPE})...${NC}"
NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
echo -e "${GREEN}New version: ${NEW_VERSION}${NC}"

# Extract clean version number
VERSION=$(echo $NEW_VERSION | sed 's/v//')

# Create git commit
git add package.json package-lock.json
git commit -m "chore: release ${NEW_VERSION}

- Updated version to ${VERSION}
- Ready for npm publish"

# Create and push tag
echo -e "${GREEN}Creating git tag...${NC}"
git tag -a "${NEW_VERSION}" -m "Release ${NEW_VERSION}"

# Push commit and tag
echo -e "${GREEN}Pushing to origin...${NC}"
git push origin main
git push origin "${NEW_VERSION}"

echo -e "${GREEN}✅ Release process complete!${NC}"
echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Go to https://github.com/just-every/ensemble/releases/new"
echo -e "2. Select tag: ${NEW_VERSION}"
echo -e "3. Set release title: ${NEW_VERSION}"
echo -e "4. Add release notes"
echo -e "5. Click 'Publish release' to trigger npm publish"
echo -e ""
echo -e "Or use workflow dispatch:"
echo -e "1. Go to https://github.com/just-every/ensemble/actions/workflows/publish.yml"
echo -e "2. Click 'Run workflow'"
echo -e "3. Enter version: ${VERSION}"
echo -e "4. Click 'Run workflow'"