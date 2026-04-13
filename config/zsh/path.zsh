# PATH + runtime environments
# Loaded first so all subsequent modules can find their binaries.

# Remove any lingering hooks from uninstalled tools (e.g. direnv)
unfunction _direnv_hook 2>/dev/null
precmd_functions=(${precmd_functions:#_direnv_hook})
chpwd_functions=(${chpwd_functions:#_direnv_hook})

HOMEBREW_PREFIX="/opt/homebrew"

export PATH="$HOMEBREW_PREFIX/bin:/usr/local/bin:$PATH"  # homebrew, claude cli
export PATH="$HOMEBREW_PREFIX/opt/mysql/bin:$PATH"       # mysql
export PATH="$PATH:$HOME/.local/bin"                     # pipx
export PATH="$PATH:$HOME/.npm-global/bin"                # npm globals

eval "$(fnm env --use-on-cd --shell zsh)"                # fnm — node version manager

export PNPM_HOME="$HOME/Library/pnpm"                   # pnpm
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
