// Regex-based secret scanner. This is advisory (used inside Kontrolix's own
// pipeline/UI), not a replacement for GitHub's push protection — it exists so
// secrets get caught *before* a commit/push, not after.

const RULES = [
  { type: 'Private Key', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { type: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'AWS Secret Access Key', regex: /\b(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Za-z0-9\/+=]{40}['"]?/g },
  { type: 'GitHub Token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  { type: 'Slack Token', regex: /\bxox[baprs]-[0-9A-Za-z-]{10,48}\b/g },
  { type: 'Google API Key', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { type: 'Stripe Key', regex: /\bsk_live_[0-9a-zA-Z]{24,}\b/g },
  { type: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { type: 'Generic API Key', regex: /\b(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi },
  { type: 'Generic Secret/Password', regex: /\b(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{6,}['"]/gi },
];

function redact(match) {
  if (match.length <= 10) return '*'.repeat(match.length);
  return `${match.slice(0, 4)}…${match.slice(-4)} (${match.length} chars)`;
}

/**
 * @param {string} content
 * @param {string} filename - for context in the result, not used for matching
 * @returns {{ type: string, line: number, redacted: string }[]}
 */
function scanContent(content, filename = '') {
  const findings = [];
  const lines = content.split('\n');

  lines.forEach((lineText, idx) => {
    for (const rule of RULES) {
      rule.regex.lastIndex = 0;
      let m;
      while ((m = rule.regex.exec(lineText)) !== null) {
        findings.push({
          type: rule.type,
          file: filename,
          line: idx + 1,
          redacted: redact(m[0]),
        });
        if (!rule.regex.global) break;
      }
    }
  });

  return findings;
}

/**
 * @param {{ name: string, content: string }[]} files
 */
function scanFiles(files) {
  const allFindings = [];
  for (const f of files) {
    allFindings.push(...scanContent(f.content, f.name));
  }
  return allFindings;
}

module.exports = { scanContent, scanFiles };
