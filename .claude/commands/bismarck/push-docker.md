# push-docker

Manually build and push the bismarck-agent Docker image to Docker Hub (multi-arch: amd64 + arm64).

## Usage
```
/bismarck:push-docker
```

## When to Use
- After making Dockerfile changes that you want to test before a full release
- To push a new image version outside of the CI release cycle
- To verify the Docker image builds correctly for both architectures

## How It Works

When the user invokes `/bismarck:push-docker`, follow these steps:

### 1. Check prerequisites
```bash
docker info > /dev/null 2>&1
docker buildx version
```
Verify Docker is running and buildx is available.

### 2. Check Docker Hub login
```bash
docker info 2>/dev/null | grep Username
```
If not logged in, tell the user to run `docker login` first.

### 3. Determine version
```bash
cat package.json | grep '"version"'
```
Extract the version from package.json.

### 4. Set up buildx for multi-arch
```bash
# Create/use a buildx builder that supports multi-platform
docker buildx create --name bismarck-builder --use 2>/dev/null || docker buildx use bismarck-builder
docker buildx inspect --bootstrap
```

### 5. Build and push
```bash
VERSION=$(node -p "require('./package.json').version")

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --build-arg BISMARCK_VERSION=$VERSION \
  -t bismarckapp/bismarck-agent:latest \
  -t bismarckapp/bismarck-agent:$VERSION \
  -f docker/Dockerfile \
  --push \
  docker/
```

### 6. Verify the push
```bash
docker manifest inspect bismarckapp/bismarck-agent:latest
docker manifest inspect bismarckapp/bismarck-agent:$VERSION
```

### 7. Report success
Show:
- Image tags pushed: `bismarckapp/bismarck-agent:latest` and `bismarckapp/bismarck-agent:<version>`
- Architectures: `linux/amd64`, `linux/arm64`
- Docker Hub URL: `https://hub.docker.com/r/bismarckapp/bismarck-agent`

## Important Notes
- Multi-arch builds require `docker buildx` (included with Docker Desktop)
- The build context is the `docker/` directory
- Build time is ~10-15 minutes for both architectures
- Docker Hub credentials: use `docker login` to authenticate before running
