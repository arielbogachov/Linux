// Best-effort, rule-based Dockerfile optimizer.
// Safe/mechanical changes (base image swap, USER, HEALTHCHECK) are auto-applied.
// Riskier structural changes (multi-stage build split) are only suggested as text,
// since blindly rewriting build semantics can break the image.

const SLIMMER_BASE_IMAGES = [
  { match: /^node:(\d+)(\.\d+)?(\.\d+)?$/, replace: (m) => `node:${m[1]}-alpine` },
  { match: /^node:(\d+)(\.\d+)?(\.\d+)?-bullseye$/, replace: (m) => `node:${m[1]}-alpine` },
  { match: /^python:(\d+\.\d+)$/, replace: (m) => `python:${m[1]}-slim` },
  { match: /^python:(\d+\.\d+)-bullseye$/, replace: (m) => `python:${m[1]}-slim` },
  { match: /^golang:(\d+\.\d+)$/, replace: (m) => `golang:${m[1]}-alpine` },
  { match: /^openjdk:(\d+)$/, replace: (m) => `openjdk:${m[1]}-slim` },
];

function suggestSlimBase(image) {
  // image like "node:20" or "node:20@sha256:..." — strip digest for matching
  const bare = image.split('@')[0];
  for (const rule of SLIMMER_BASE_IMAGES) {
    const m = bare.match(rule.match);
    if (m) return rule.replace(m);
  }
  return null;
}

/**
 * @param {string} content - raw Dockerfile content
 * @returns {{ optimized: string, changes: string[], suggestions: string[] }}
 */
function optimizeDockerfile(content) {
  const lines = content.split('\n');
  const changes = [];
  const suggestions = [];

  const fromLines = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => /^\s*FROM\s+/i.test(line));

  const isMultiStage = fromLines.length > 1;
  const hasUser = lines.some((l) => /^\s*USER\s+/i.test(l));
  const hasHealthcheck = lines.some((l) => /^\s*HEALTHCHECK\s+/i.test(l));
  const exposeLine = lines.find((l) => /^\s*EXPOSE\s+/i.test(l));
  const usesScratch = fromLines.some(({ line }) => /FROM\s+scratch/i.test(line));

  // 1. Base image swap (last FROM = final runtime stage, safest one to swap)
  const lastFrom = fromLines[fromLines.length - 1];
  if (lastFrom) {
    const m = lastFrom.line.match(/^(\s*FROM\s+)([^\s]+)(.*)$/i);
    if (m) {
      const [, prefix, image, suffix] = m;
      const slimImage = suggestSlimBase(image);
      if (slimImage) {
        lines[lastFrom.idx] = `${prefix}${slimImage}${suffix}`;
        changes.push(`Swapped base image "${image}" → "${slimImage}" for a smaller runtime footprint — re-test the build, some native deps behave differently on alpine (musl vs glibc)`);
      }
    }
  }

  // 2. Non-root user (skip for FROM scratch — no shell/useradd tooling to run)
  if (!hasUser && !usesScratch) {
    const insertAt = lines.length; // append near the end, before CMD/ENTRYPOINT if present
    const cmdIdx = lines.findIndex((l) => /^\s*(CMD|ENTRYPOINT)\s+/i.test(l));
    const userBlock = [
      '',
      '# Run as a non-root user',
      'RUN addgroup -S appgroup 2>/dev/null || groupadd -r appgroup; \\',
      '    adduser -S appuser -G appgroup 2>/dev/null || useradd -r -g appgroup appuser',
      'USER appuser',
    ];
    if (cmdIdx !== -1) {
      lines.splice(cmdIdx, 0, ...userBlock, '');
    } else {
      lines.splice(insertAt, 0, ...userBlock);
    }
    changes.push('Added a non-root user and USER directive — the addgroup/adduser line tries both Alpine and Debian/Ubuntu syntax so it works on either base image');
  } else if (usesScratch) {
    suggestions.push('Base image is "scratch" — there is no shell to create a user, so run the built binary with a numeric USER set at build time in the builder stage instead (e.g. USER 1000 before copying), or set runAsUser in your Kubernetes securityContext.');
  }

  // 3. HEALTHCHECK if a port is exposed
  if (exposeLine && !hasHealthcheck) {
    const portMatch = exposeLine.match(/EXPOSE\s+(\d+)/i);
    const port = portMatch ? portMatch[1] : '3000';
    const cmdIdx2 = lines.findIndex((l) => /^\s*(CMD|ENTRYPOINT)\s+/i.test(l));
    const healthLine = `HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD wget --spider -q http://localhost:${port}/ || exit 1`;
    if (cmdIdx2 !== -1) {
      lines.splice(cmdIdx2, 0, healthLine, '');
    } else {
      lines.push('', healthLine);
    }
    changes.push(`Added a HEALTHCHECK against port ${port} — swap "wget" for curl or a custom check if wget isn't available in the base image`);
  }

  // 4. Multi-stage suggestion (not auto-applied — structural/build-tool risk)
  if (!isMultiStage) {
    const hasBuildTooling = /\b(npm ci|npm install|pip install|go build|mvn |gradle |gcc |make )\b/i.test(content);
    if (hasBuildTooling) {
      suggestions.push('This looks like a single-stage build that installs build tooling into the final image. Consider splitting into a multi-stage build: compile/install in a "builder" stage, then COPY only the built artifacts into a slim final stage — this drops compilers and dev dependencies from the shipped image.');
    }
  }

  return { optimized: lines.join('\n'), changes, suggestions };
}

module.exports = { optimizeDockerfile };
