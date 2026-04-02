---
description: Never expose secrets in documentation or git-tracked files
---

# Security in Documentation

**Never expose** real IPs, passwords, usernames, tokens, API keys, hostnames, Tailscale IPs, internal service URLs, or any sensitive configuration values in:
- README files or any documentation
- Code comments
- Any file tracked by git

Use placeholders: `<your-domain>`, `<tailscale-ip>`, `<see-1password>`, `example.com`.
All actual values go in 1Password.
