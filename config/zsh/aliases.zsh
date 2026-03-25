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

# Claude Code queue
#   cq add "task"     append single-line task
#   cq add            append multi-line task via stdin (Ctrl+D)
#   cq list           show all pending tasks
#   cq status         pending count
#   cq edit           open cqueue.md in $EDITOR
#   cq stop           append STOP sentinel (ends queue)
#   cq clear          empty the queue
alias cq="bun ~/.claude/queue.ts"

# IU (work)
alias start-iu-fe="~/IuRoot/prometheus-scripts/bash/start-frontends.sh"
alias sync-iu-db="~/IuRoot/prometheus-scripts/bash/sync-dev-db.sh"

# Node
alias npmplease="rm -rf node_modules/ && rm -f package-lock.json && npm install"
