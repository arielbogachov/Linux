// Two-phase flow for beginners:
//   1. detectStack(files)  — look at filenames/contents, guess language + defaults
//   2. generateDockerfile(config) — build a real Dockerfile from a (possibly
//      hand-edited) config, so the person can confirm/tweak before generating

const STACKS = {
  node: {
    label: 'Node.js',
    detectFiles: ['package.json'],
    defaultPort: 3000,
    defaultBuildCmd: null,
    defaultStartCmd: null, // filled in from package.json "scripts.start" or "main" if found
  },
  python: {
    label: 'Python',
    detectFiles: ['requirements.txt', 'pyproject.toml'],
    defaultPort: 8000,
    defaultStartCmd: 'python app.py',
  },
  go: {
    label: 'Go',
    detectFiles: ['go.mod'],
    defaultPort: 8080,
    defaultStartCmd: null,
  },
  java: {
    label: 'Java (Maven)',
    detectFiles: ['pom.xml'],
    defaultPort: 8080,
    defaultStartCmd: null,
  },
  staticSite: {
    label: 'Static site (HTML/CSS/JS)',
    detectFiles: ['index.html'],
    defaultPort: 80,
    defaultStartCmd: null,
  },
};

/**
 * @param {{ name: string, content?: string }[]} files - filenames present in the project
 *   (content only needed for package.json, to pull start script / port hints)
 * @returns {{ stack: string, label: string, port: number, startCommand: string, buildCommand: string|null, confidence: string }}
 */
function detectStack(files) {
  const names = files.map((f) => f.name.toLowerCase());

  for (const [key, def] of Object.entries(STACKS)) {
    const matchedFile = def.detectFiles.find((df) => names.some((n) => n.endsWith(df.toLowerCase())));
    if (!matchedFile) continue;

    let startCommand = def.defaultStartCmd;
    let buildCommand = def.defaultBuildCmd || null;
    let port = def.defaultPort;

    if (key === 'node') {
      const pkgFile = files.find((f) => f.name.toLowerCase().endsWith('package.json'));
      if (pkgFile?.content) {
        try {
          const pkg = JSON.parse(pkgFile.content);
          if (pkg.scripts?.start) startCommand = 'npm start';
          else if (pkg.main) startCommand = `node ${pkg.main}`;
          if (pkg.scripts?.build) buildCommand = 'npm run build';
        } catch {
          /* unparseable package.json — fall through to generic defaults below */
        }
      }
      startCommand = startCommand || 'node index.js';
    }

    if (key === 'go') startCommand = 'go build -o app . && ./app';
    if (key === 'java') startCommand = 'java -jar target/*.jar';
    if (key === 'staticSite') startCommand = null; // served by nginx, not a "run" command

    return {
      stack: key,
      label: def.label,
      port,
      startCommand,
      buildCommand,
      confidence: 'detected from project files',
    };
  }

  return { stack: 'unknown', label: 'Unrecognized', port: 8080, startCommand: null, buildCommand: null, confidence: 'no known stack files found — fill in manually' };
}

/**
 * @param {object} config
 * @param {string} config.stack - node | python | go | java | staticSite
 * @param {number} config.port
 * @param {string} config.startCommand
 * @param {string} [config.buildCommand]
 * @returns {string} a complete, working Dockerfile
 */
function generateDockerfile(config) {
  const { stack, port, startCommand, buildCommand } = config;

  switch (stack) {
    case 'node':
      return [
        'FROM node:20-alpine AS builder',
        'WORKDIR /app',
        'COPY package*.json ./',
        'RUN npm ci',
        'COPY . .',
        buildCommand ? `RUN ${buildCommand}` : null,
        '',
        'FROM node:20-alpine',
        'WORKDIR /app',
        'RUN addgroup -S appgroup && adduser -S appuser -G appgroup',
        'COPY --from=builder /app ./',
        'ENV NODE_ENV=production',
        `EXPOSE ${port}`,
        `HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD wget --spider -q http://localhost:${port}/ || exit 1`,
        'USER appuser',
        `CMD ["sh", "-c", "${(startCommand || 'node index.js').replace(/"/g, '\\"')}"]`,
      ].filter((l) => l !== null).join('\n');

    case 'python':
      return [
        'FROM python:3.12-slim AS builder',
        'WORKDIR /app',
        'COPY requirements.txt .',
        'RUN pip install --no-cache-dir --user -r requirements.txt',
        'COPY . .',
        '',
        'FROM python:3.12-slim',
        'WORKDIR /app',
        'RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser',
        'COPY --from=builder /root/.local /home/appuser/.local',
        'COPY --from=builder /app ./',
        'ENV PATH=/home/appuser/.local/bin:$PATH',
        `EXPOSE ${port}`,
        `HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${port}/')" || exit 1`,
        'USER appuser',
        `CMD ["sh", "-c", "${(startCommand || 'python app.py').replace(/"/g, '\\"')}"]`,
      ].join('\n');

    case 'go':
      return [
        'FROM golang:1.22-alpine AS builder',
        'WORKDIR /app',
        'COPY go.mod go.sum* ./',
        'RUN go mod download',
        'COPY . .',
        'RUN CGO_ENABLED=0 go build -o /app/bin/app .',
        '',
        'FROM alpine:3.20',
        'RUN addgroup -S appgroup && adduser -S appuser -G appgroup',
        'WORKDIR /app',
        'COPY --from=builder /app/bin/app .',
        `EXPOSE ${port}`,
        `HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD wget --spider -q http://localhost:${port}/ || exit 1`,
        'USER appuser',
        'CMD ["./app"]',
      ].join('\n');

    case 'java':
      return [
        'FROM maven:3.9-eclipse-temurin-21 AS builder',
        'WORKDIR /app',
        'COPY pom.xml .',
        'RUN mvn -B dependency:go-offline',
        'COPY src ./src',
        'RUN mvn -B package -DskipTests',
        '',
        'FROM eclipse-temurin:21-jre-alpine',
        'RUN addgroup -S appgroup && adduser -S appuser -G appgroup',
        'WORKDIR /app',
        'COPY --from=builder /app/target/*.jar app.jar',
        `EXPOSE ${port}`,
        `HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD wget --spider -q http://localhost:${port}/ || exit 1`,
        'USER appuser',
        'CMD ["java", "-jar", "app.jar"]',
      ].join('\n');

    case 'staticSite':
      return [
        'FROM nginx:1.27-alpine',
        'COPY . /usr/share/nginx/html',
        `EXPOSE ${port}`,
        `HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD wget --spider -q http://localhost:${port}/ || exit 1`,
        '# nginx runs as a dedicated low-privilege user by default on the alpine image',
      ].join('\n');

    default:
      throw new Error(`Unknown or undetected stack "${stack}" — pick one of: node, python, go, java, staticSite`);
  }
}

module.exports = { detectStack, generateDockerfile, STACKS };
