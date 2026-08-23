// Small, hand-maintained table of "this major version is EOL or aging" rules.
// Deliberately conservative — this flags as a suggestion, it never auto-bumps
// a major version, since that can silently change runtime behavior.

const EOL_RULES = [
  { family: 'node', regex: /^node:(\d+)/, minSupported: 18, recommend: 'node:20-alpine or node:22-alpine' },
  { family: 'python', regex: /^python:(\d+)\.(\d+)/, minSupported: [3, 10], recommend: 'python:3.12-slim' },
  { family: 'ubuntu', regex: /^ubuntu:(\d+)\.(\d+)/, minSupported: [20, 4], recommend: 'ubuntu:22.04 or ubuntu:24.04' },
  { family: 'debian', regex: /^debian:(buster|stretch|jessie)\b/i, recommend: 'debian:bookworm or debian:bullseye' },
  { family: 'alpine', regex: /^alpine:(\d+)\.(\d+)/, minSupported: [3, 18], recommend: 'alpine:3.20' },
];

function versionAtLeast(actual, min) {
  for (let i = 0; i < min.length; i++) {
    if ((actual[i] ?? 0) > min[i]) return true;
    if ((actual[i] ?? 0) < min[i]) return false;
  }
  return true;
}

/**
 * @param {string} image - e.g. "node:14", "python:3.8", "ubuntu:18.04"
 * @returns {{ outdated: boolean, family?: string, reason?: string, recommend?: string }}
 */
function checkVulnerableBase(image) {
  const bare = image.split('@')[0];

  for (const rule of EOL_RULES) {
    const m = bare.match(rule.regex);
    if (!m) continue;

    if (rule.family === 'debian') {
      return { outdated: true, family: 'debian', reason: `"${m[1]}" is an old Debian codename, likely past security support`, recommend: rule.recommend };
    }

    const actual = rule.minSupported.length === 1 ? [parseInt(m[1], 10)] : [parseInt(m[1], 10), parseInt(m[2], 10)];
    const min = Array.isArray(rule.minSupported) ? rule.minSupported : [rule.minSupported];
    if (!versionAtLeast(actual, min)) {
      const minLabel = min.length === 1 ? `${min[0]}` : `${min[0]}.${String(min[1]).padStart(2, '0')}`;
      return {
        outdated: true,
        family: rule.family,
        reason: `${bare} is below the actively-supported ${rule.family} line (${minLabel}+)`,
        recommend: rule.recommend,
      };
    }
    return { outdated: false };
  }

  return { outdated: false }; // unknown family — no opinion
}

module.exports = { checkVulnerableBase };
