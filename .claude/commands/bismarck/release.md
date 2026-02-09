# release

Creates a new GitHub release for Bismarck with proper semantic versioning and release notes from annotated tags.

## Usage
```
/bismarck:release [patch|minor|major]
```

If no argument provided, defaults to `patch`.

## Version Strategy (v0.x.x - Pre-1.0)
- We are in v0.x.x (pre-release/beta phase)
- `patch` (0.0.x): Bug fixes, small improvements
- `minor` (0.x.0): New features, breaking changes during v0 are OK here
- `major`: Reserved for 1.0.0 stable release

## How It Works
- GitHub Actions builds the DMG automatically when a tag is pushed
- Release notes come from the **annotated tag message**
- The workflow adds install instructions and changelog link automatically

When the user invokes `/bismarck:release`, follow these steps:

### 1. Check for clean working directory
```bash
git status --porcelain
```
If there are uncommitted changes, warn the user and ask if they want to proceed.

### 2. Determine version bump and show current version
Parse the argument (default to "patch" if none provided)
```bash
cat package.json | grep '"version"'
git tag --sort=-v:refname | head -1
```

### 3. Get commits since last tag for release notes
```bash
git log <last-tag>..HEAD --oneline
```

### 4. Generate release notes
Categorize commits and create release notes:
- `feat:` → Features
- `fix:` → Bug Fixes
- `refactor:` → Improvements
- Other prefixes → Other changes

Format:
```
v<version>

## What's New

- Description of change 1
- Description of change 2
```

### 5. Show proposed release and ask for confirmation
Display the new version number and release notes, then use `AskUserQuestion` to confirm:
- Header: "Release"
- Question: "Release v<new-version>? (release notes shown above)"
- Options: "Ship it" (proceed with release), "Edit notes" (let user provide revised notes), "Cancel" (abort release)

### 6. Execute the release
```bash
# Bump version
npm version [patch|minor|major] --no-git-tag-version

# Commit
git add package.json package-lock.json
git commit --no-gpg-sign -m "v<new-version>"

# Create annotated tag with release notes
# IMPORTANT: --cleanup=verbatim preserves ## markdown headings (git treats # as comments by default)
git tag -a v<new-version> --cleanup=verbatim -m "$(cat <<'EOF'
v<new-version>

## What's New

- Release note 1
- Release note 2
EOF
)"

# Push (triggers GitHub Actions to build DMG and create release)
git push origin main
git push origin v<new-version>
```

### 7. Wait for GitHub Actions to succeed
After pushing, poll the GitHub Actions workflow until it completes:
```bash
gh run list --limit 1 --repo cameronfleet-paxos/bismarck
```
Check every 30 seconds until the run status is `completed` with conclusion `success`. If the run fails, alert the user immediately with the failure details:
```bash
gh run view <run-id> --repo cameronfleet-paxos/bismarck --log-failed
```

### 8. Report success
Show:
- Link to GitHub Actions workflow: `https://github.com/cameronfleet-paxos/bismarck/actions`
- Confirm the release build succeeded
- Install command: `curl -fsSL https://raw.githubusercontent.com/cameronfleet-paxos/bismarck/main/install.sh | bash`

## Important Notes
- Always use `--no-gpg-sign` for commits (GPG signing may fail)
- Always use `--cleanup=verbatim` with `git tag -a` to preserve `##` markdown headings (git's default cleanup treats `#` lines as comments and strips them)
- The tag message first line should be the version (gets stripped by workflow)
- GitHub Actions automatically builds DMG and creates release from tag annotation
- No need to build locally - CI handles everything!
