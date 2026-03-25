# PATH + runtime environments
# Loaded first so all subsequent modules can find their binaries.

HOMEBREW_PREFIX="/opt/homebrew"

export PATH="$HOMEBREW_PREFIX/bin:/usr/local/bin:$PATH"  # homebrew, claude cli
export PATH="$HOMEBREW_PREFIX/opt/mysql/bin:$PATH"       # mysql
export PATH="$PATH:$HOME/.local/bin"                     # pipx
export PATH="$PATH:$HOME/.npm-global/bin"                # npm globals

eval "$(fnm env --use-on-cd --shell zsh)"                # fnm — node version manager
. "$HOME/.deno/env"                                      # deno
