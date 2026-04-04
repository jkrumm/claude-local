# Aliases and one-liners

# Shell
alias sz="source ~/.zshrc"                                # reload config
alias zh="awk '/OPENSPEC:END/{f=1;next} f&&/^for /{exit} f&&/^#/{sub(/^# ?/,\"\");print}' ~/.zshrc"  # print this help

# Git
alias gback="git reset --soft HEAD~1"                     # undo last commit, keep changes staged

# SSH
alias homelab="ssh homelab"
alias vps="ssh vps"

# Apps
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
zed() { /opt/homebrew/bin/zed "${1:-.}" }                 # open dir (or cwd) in Zed

# 1Password backup
alias opbackup="~/SourceRoot/claude-local/scripts/backup-1password.py"

# IU (work)
alias start-iu-fe="~/IuRoot/prometheus-scripts/bash/start-frontends.sh"
alias sync-iu-db="~/IuRoot/prometheus-scripts/bash/sync-dev-db.sh"

# Node
alias npmplease="rm -rf node_modules/ && rm -f package-lock.json && npm install"
