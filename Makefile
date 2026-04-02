CLAUDE_LOCAL := $(shell pwd)
CLAUDE_DIR   := $(HOME)/.claude
SOURCEROOT   := $(HOME)/SourceRoot

# ============================================================================
# Setup — idempotent, safe to run on a fresh machine or re-run after changes
# Existing real files are backed up to <file>.bak before being replaced.
# ============================================================================

.PHONY: setup
setup:
	@echo ""
	@echo "  Setting up claude-local..."
	@echo ""
	@$(MAKE) --no-print-directory _check-prereqs
	@$(MAKE) --no-print-directory _setup-brew
	@$(MAKE) --no-print-directory _setup-claude
	@$(MAKE) --no-print-directory _setup-config
	@$(MAKE) --no-print-directory _setup-hooks
	@$(MAKE) --no-print-directory _setup-scripts
	@$(MAKE) --no-print-directory _setup-skills
	@$(MAKE) --no-print-directory _setup-settings
	@$(MAKE) --no-print-directory _setup-gitignore
	@$(MAKE) --no-print-directory _setup-ghostty
	@$(MAKE) --no-print-directory _setup-tools
	@$(MAKE) --no-print-directory _setup-browser
	@$(MAKE) --no-print-directory _setup-localias
	@$(MAKE) --no-print-directory _setup-pnpm
	@$(MAKE) --no-print-directory _setup-viteplus
	@$(MAKE) --no-print-directory _setup-op-token
	@echo ""
	@echo "  Done. Reload your shell: source ~/.zshrc"
	@echo ""

.PHONY: _check-prereqs
_check-prereqs:
	@echo "  Checking prerequisites..."
	@if [ ! -d "/Applications/1Password.app" ] && [ ! -d "$(HOME)/Applications/1Password.app" ]; then \
		echo ""; \
		echo "  ✗ 1Password app not found."; \
		echo ""; \
		echo "    Install 1Password before running make setup:"; \
		echo "      https://1password.com/downloads/mac/"; \
		echo ""; \
		echo "    Then install the CLI integration:"; \
		echo "      System Preferences → 1Password → Developer → Enable CLI"; \
		echo ""; \
		exit 1; \
	fi
	@if ! command -v op >/dev/null 2>&1; then \
		echo ""; \
		echo "  ✗ 1Password CLI (op) not found."; \
		echo ""; \
		echo "    Enable the CLI in 1Password:"; \
		echo "      System Preferences → 1Password → Developer → Enable CLI"; \
		echo ""; \
		exit 1; \
	fi
	@echo "    ✓ 1Password app + CLI ready"

.PHONY: _setup-brew
_setup-brew:
	@echo "  Homebrew..."
	@if command -v brew >/dev/null 2>&1; then \
		echo "    · brew $$(brew --version | head -1) (ok)"; \
	else \
		echo "    Installing Homebrew..."; \
		/bin/bash -c "$$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; \
		echo "    ✓ Homebrew installed"; \
	fi

.PHONY: _setup-claude
_setup-claude:
	@echo "  Claude Code..."
	@if command -v claude >/dev/null 2>&1; then \
		echo "    · claude $$(claude --version 2>/dev/null | head -1) (ok)"; \
	else \
		echo "    Installing Claude Code..."; \
		curl -fsSL https://claude.ai/install.sh | bash; \
		echo "    ✓ Claude Code installed"; \
	fi

.PHONY: _setup-config
_setup-config:
	@echo "  Config..."
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/global.CLAUDE.md" \
		DST="$(CLAUDE_DIR)/CLAUDE.md"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/sourceroot.CLAUDE.md" \
		DST="$(SOURCEROOT)/CLAUDE.md"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/zshrc" \
		DST="$(HOME)/.zshrc"
	@mkdir -p $(HOME)/.zsh
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/zsh" \
		DST="$(HOME)/.zsh/conf.d"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/gitconfig" \
		DST="$(HOME)/.gitconfig"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/gitconfig-personal" \
		DST="$(HOME)/.gitconfig-personal"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/gitconfig-work" \
		DST="$(HOME)/.gitconfig-work"
	@LOCALIAS_SRC="$(CLAUDE_LOCAL)/config/localias.yaml"; \
	 LOCALIAS_DST="$(HOME)/Library/Application Support/localias.yaml"; \
	 if [ -L "$$LOCALIAS_DST" ] && [ "$$(readlink "$$LOCALIAS_DST")" = "$$LOCALIAS_SRC" ]; then \
	   echo "    · localias.yaml (ok)"; \
	 else \
	   if [ -e "$$LOCALIAS_DST" ] && [ ! -L "$$LOCALIAS_DST" ]; then \
	     mv "$$LOCALIAS_DST" "$$LOCALIAS_DST.bak"; \
	   fi; \
	   ln -sfn "$$LOCALIAS_SRC" "$$LOCALIAS_DST"; \
	   echo "    ✓ localias.yaml"; \
	 fi

.PHONY: _setup-tools
_setup-tools:
	@echo "  Tools..."
	@# jq — required by this Makefile itself
	@brew list jq &>/dev/null || brew install jq
	@echo "    ✓ jq $$(jq --version)"
	@# gh — GitHub CLI (used by /pr skill)
	@brew list gh &>/dev/null || brew install gh
	@echo "    ✓ gh $$(gh --version | head -1)"
	@# fzf — fuzzy finder (Ctrl+R, Ctrl+T, Alt+C)
	@brew list fzf &>/dev/null || brew install fzf
	@echo "    ✓ fzf $$(fzf --version)"
	@# zoxide — smart cd (j command)
	@brew list zoxide &>/dev/null || brew install zoxide
	@echo "    ✓ zoxide $$(zoxide --version)"
	@# wtp — git worktree manager
	@brew list satococoa/tap/wtp &>/dev/null || brew install satococoa/tap/wtp
	@echo "    ✓ wtp $$(wtp --version 2>/dev/null || echo ok)"
	@# fnm — node version manager
	@brew list fnm &>/dev/null || brew install fnm
	@echo "    ✓ fnm $$(fnm --version)"
	@# uv — Python runner (required by statusline.sh + fetch_usage.py)
	@brew list uv &>/dev/null || brew install uv
	@echo "    ✓ uv $$(uv --version)"
	@# age — encryption for 1Password backup
	@brew list age &>/dev/null || brew install age
	@echo "    ✓ age $$(age --version)"
	@# bun — JS runtime (cq alias, hooks)
	@if command -v bun >/dev/null 2>&1; then \
		echo "    · bun $$(bun --version) (ok)"; \
	else \
		echo "    Installing bun..."; \
		curl -fsSL https://bun.sh/install | bash; \
		echo "    ✓ bun installed"; \
	fi

.PHONY: _setup-localias
_setup-localias:
	@echo "  Localias..."
	@brew list peterldowns/tap/localias &>/dev/null || brew install peterldowns/tap/localias
	@localias start >/dev/null 2>&1 || true
	@localias reload >/dev/null 2>&1 || true
	@echo "    ✓ localias daemon"
	@brew list sleepwatcher &>/dev/null || brew install sleepwatcher
	@brew services start sleepwatcher >/dev/null 2>&1 || brew services restart sleepwatcher >/dev/null 2>&1 || true
	@echo "    ✓ sleepwatcher service"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/scripts/wakeup.sh" \
		DST="$(HOME)/.wakeup"
	@chmod +x $(CLAUDE_LOCAL)/scripts/wakeup.sh

.PHONY: _setup-pnpm
_setup-pnpm:
	@echo "  pnpm..."
	@if command -v pnpm >/dev/null 2>&1; then \
		echo "    Updating pnpm..."; \
		pnpm self-update 2>&1 | tail -1; \
		echo "    · pnpm $$(pnpm --version) (ok)"; \
	else \
		echo "    Installing pnpm..."; \
		curl -fsSL https://get.pnpm.io/install.sh | sh -; \
		echo "    ✓ pnpm installed"; \
	fi

.PHONY: _setup-viteplus
_setup-viteplus:
	@echo "  Vite+..."
	@if [ -f "$$HOME/.vite-plus/env" ]; then \
		echo "    · Vite+ (ok)"; \
	else \
		echo "    Installing Vite+..."; \
		curl -fsSL https://vite.plus | bash; \
		echo "    ✓ Vite+ installed (node version managed via fnm)"; \
	fi

.PHONY: _setup-op-token
_setup-op-token:
	@echo "  1Password CLI (personal account: tkrumm)..."
	@if [ ! -S "$$HOME/.config/op/op-daemon.sock" ]; then \
		echo "    ✗ op daemon socket missing — is 1Password app running?"; \
		echo "      Start 1Password, then re-run: make setup"; \
		exit 1; \
	fi
	@echo "    · op-daemon.sock (ok)"
	@if op whoami --account tkrumm >/dev/null 2>&1; then \
		echo "    · op session (ok, $$(op whoami --account tkrumm --format=json 2>/dev/null | jq -r '.email // "unknown"'))"; \
	else \
		echo "    Triggering Touch ID sign-in for tkrumm..."; \
		op vault list --account tkrumm >/dev/null 2>&1 || true; \
		if op whoami --account tkrumm >/dev/null 2>&1; then \
			echo "    ✓ op session established"; \
		else \
			echo "    ✗ op sign-in failed — run manually: op vault list --account tkrumm"; \
		fi; \
	fi
	@echo "    · ANTHROPIC_API_KEY not exported (Claude Code uses subscription)"
	@#
	@# [SERVICE ACCOUNT — disabled]
	@# TOKEN=$$(security find-generic-password -a "$$USER" -s "op-service-account-token" -w 2>/dev/null); \
	@# KEY=$$(OP_SERVICE_ACCOUNT_TOKEN="$$TOKEN" op read "op://CLI/Anthropic/credential" 2>/dev/null); \
	@# security add-generic-password -U -a "$$USER" -s "anthropic-api-key" -w "$$KEY" -T /usr/bin/security

.PHONY: _setup-hooks
_setup-hooks:
	@echo "  Hooks..."
	@mkdir -p $(CLAUDE_DIR)/hooks
	@chmod +x $(CLAUDE_LOCAL)/hooks/*.ts
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/hooks/notify.ts" \
		DST="$(CLAUDE_DIR)/hooks/notify.ts"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/hooks/protect-branches.ts" \
		DST="$(CLAUDE_DIR)/hooks/protect-branches.ts"

.PHONY: _setup-scripts
_setup-scripts:
	@echo "  Scripts..."
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/scripts/queue.ts" \
		DST="$(CLAUDE_DIR)/queue.ts"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/scripts/statusline.sh" \
		DST="$(CLAUDE_DIR)/statusline.sh"
	@chmod +x $(CLAUDE_LOCAL)/scripts/fetch_usage.py
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/scripts/fetch_usage.py" \
		DST="$(CLAUDE_DIR)/fetch_usage.py"

.PHONY: _setup-skills
_setup-skills:
	@echo "  Skills (SourceRoot-scoped → ~/SourceRoot/.claude/skills/)..."
	@mkdir -p $(SOURCEROOT)/.claude/skills
	@for skill in $(CLAUDE_LOCAL)/skills/*/; do \
		name=$$(basename "$$skill"); \
		$(MAKE) --no-print-directory _link SRC="$$skill" DST="$(SOURCEROOT)/.claude/skills/$$name"; \
	done

.PHONY: _setup-settings
_setup-settings:
	@echo "  Claude Code settings..."
	@if [ ! -f "$(CLAUDE_DIR)/settings.json" ]; then \
		jq 'del(._NOTE)' "$(CLAUDE_LOCAL)/config/settings.template.json" \
			> "$(CLAUDE_DIR)/settings.json"; \
		echo "    ✓ settings.json created from template"; \
	else \
		jq --slurpfile existing "$(CLAUDE_DIR)/settings.json" \
			'del(._NOTE) * {permissions: $$existing[0].permissions} * ($$existing[0] | {model, effortLevel, alwaysThinkingEnabled} | with_entries(select(.value != null)))' \
			"$(CLAUDE_LOCAL)/config/settings.template.json" \
			> /tmp/claude-settings-merged.json \
		&& mv /tmp/claude-settings-merged.json "$(CLAUDE_DIR)/settings.json"; \
		echo "    ✓ settings.json merged (template applied, permissions + model/effort preserved)"; \
	fi

.PHONY: _setup-gitignore
_setup-gitignore:
	@echo "  Global gitignore..."
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/gitignore_global" \
		DST="$(HOME)/.gitignore_global"
	@git config --global core.excludesfile "$(HOME)/.gitignore_global"
	@echo "    ✓ git config core.excludesfile"

.PHONY: _setup-ghostty
_setup-ghostty:
	@echo "  Ghostty (Blueprint v6 themes)..."
	@mkdir -p $(HOME)/.config/ghostty/themes
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/ghostty/config" \
		DST="$(HOME)/.config/ghostty/config"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/ghostty/themes/basalt-ui-light" \
		DST="$(HOME)/.config/ghostty/themes/basalt-ui-light"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/ghostty/themes/basalt-ui-dark" \
		DST="$(HOME)/.config/ghostty/themes/basalt-ui-dark"
	@# Clean up old unmanaged theme files
	@for old in ayu-mirage basalt-ui; do \
		if [ -f "$(HOME)/.config/ghostty/themes/$$old" ] && [ ! -L "$(HOME)/.config/ghostty/themes/$$old" ]; then \
			mv "$(HOME)/.config/ghostty/themes/$$old" "$(HOME)/.config/ghostty/themes/$$old.bak"; \
			echo "    ✓ backed up old $$old theme"; \
		fi; \
	done

.PHONY: _setup-browser
_setup-browser:
	@echo "  Browser debugging..."
	@# chrome-devtools MCP — always re-register to ensure flags are up to date
	@# Flags: --headless (no window), --isolated (throwaway profile per session), --usageStatistics=false (privacy)
	@claude mcp remove chrome-devtools --scope user 2>/dev/null || true
	@claude mcp add chrome-devtools --scope user -- npx -y chrome-devtools-mcp@latest --isolated --headless --usageStatistics=false
	@echo "    ✓ chrome-devtools MCP registered"
	@# Permission — patch into live settings if missing (fresh machines preserve template on first run)
	@if jq -e '.permissions.allow | contains(["mcp__chrome-devtools__*"])' "$(CLAUDE_DIR)/settings.json" > /dev/null 2>&1; then \
		echo "    · mcp__chrome-devtools__* permission (ok)"; \
	else \
		jq '.permissions.allow += ["mcp__chrome-devtools__*"]' "$(CLAUDE_DIR)/settings.json" > /tmp/claude-browser-perm.json \
		&& mv /tmp/claude-browser-perm.json "$(CLAUDE_DIR)/settings.json"; \
		echo "    ✓ mcp__chrome-devtools__* permission added"; \
	fi

.PHONY: _link
_link:
	@if [ -L "$(DST)" ] && [ "$$(readlink $(DST))" = "$(SRC)" ]; then \
		echo "    · $(notdir $(DST)) (ok)"; \
	else \
		if [ -e "$(DST)" ] && [ ! -L "$(DST)" ]; then \
			echo "    Backing up $(DST) → $(DST).bak"; \
			mv "$(DST)" "$(DST).bak"; \
		fi; \
		ln -sfn "$(SRC)" "$(DST)"; \
		echo "    ✓ $(notdir $(DST))"; \
	fi

# ============================================================================
# Status
# ============================================================================

.PHONY: status
status:
	@echo ""
	@echo "  Prerequisites"
	@[ -d "/Applications/1Password.app" ] || [ -d "$(HOME)/Applications/1Password.app" ] \
		&& echo "    ✓ 1Password app" || echo "    ✗ 1Password app [not installed]"
	@command -v op >/dev/null 2>&1 && echo "    ✓ op CLI" || echo "    ✗ op CLI [not installed]"
	@command -v brew >/dev/null 2>&1 && echo "    ✓ brew" || echo "    ✗ brew [not installed — run make setup]"
	@command -v claude >/dev/null 2>&1 && echo "    ✓ claude" || echo "    ✗ claude [not installed — run make setup]"
	@echo ""
	@echo "  Symlink health:"
	@echo ""
	@echo "  Config"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/CLAUDE.md"
	@$(MAKE) --no-print-directory _check DST="$(SOURCEROOT)/CLAUDE.md"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.zshrc"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.zsh/conf.d"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.gitconfig"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.gitconfig-personal"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.gitconfig-work"
	@LOCALIAS_DST="$(HOME)/Library/Application Support/localias.yaml"; \
	 if [ -L "$$LOCALIAS_DST" ] && [ -e "$$LOCALIAS_DST" ]; then \
	   echo "    ✓ localias.yaml"; \
	 elif [ -L "$$LOCALIAS_DST" ]; then \
	   echo "    ✗ localias.yaml [BROKEN]"; \
	 else \
	   echo "    ✗ localias.yaml [real file — run make setup]"; \
	 fi
	@echo "  1Password (personal account)"
	@if op whoami >/dev/null 2>&1; then \
		echo "    ✓ op session active ($$(op whoami --format=json 2>/dev/null | jq -r '.email // "unknown"'))"; \
	else \
		echo "    ✗ op session [expired — run make setup to re-authenticate]"; \
	fi
	@echo "    · ANTHROPIC_API_KEY not cached (Claude Code uses subscription)"
	@echo "  Settings"
	@if [ -f "$(CLAUDE_DIR)/settings.json" ]; then \
		echo "    ✓ settings.json (hooks + statusline wired)"; \
	else \
		echo "    ✗ settings.json MISSING — run make setup"; \
	fi
	@echo "  Hooks"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/hooks/notify.ts"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/hooks/protect-branches.ts"
	@echo "  Scripts"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/queue.ts"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/statusline.sh"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/fetch_usage.py"
	@echo "  Gitignore"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.gitignore_global"
	@echo "  Ghostty"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.config/ghostty/config"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.config/ghostty/themes/basalt-ui-light"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.config/ghostty/themes/basalt-ui-dark"
	@echo "  Skills ($(shell ls $(CLAUDE_LOCAL)/skills/ | wc -l | xargs) — SourceRoot only)"
	@for skill in $(CLAUDE_LOCAL)/skills/*/; do \
		name=$$(basename "$$skill"); \
		$(MAKE) --no-print-directory _check DST="$(SOURCEROOT)/.claude/skills/$$name"; \
	done
	@echo "  Tools"
	@for tool in jq gh fzf zoxide wtp fnm bun uv age; do \
		command -v $$tool >/dev/null 2>&1 \
			&& echo "    ✓ $$tool" \
			|| echo "    ✗ $$tool [not installed — run make setup]"; \
	done
	@echo "  Localias"
	@brew list peterldowns/tap/localias &>/dev/null && echo "    ✓ localias" || echo "    ✗ localias [not installed — run make setup]"
	@localias status 2>&1 | grep -q "running" && echo "    ✓ localias daemon running" || echo "    ✗ localias daemon [not running — run make setup]"
	@brew list sleepwatcher &>/dev/null && echo "    ✓ sleepwatcher" || echo "    ✗ sleepwatcher [not installed — run make setup]"
	@brew services list | grep sleepwatcher | grep -q started && echo "    ✓ sleepwatcher service started" || echo "    ✗ sleepwatcher service [not started — run make setup]"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.wakeup"
	@echo "  pnpm"
	@if command -v pnpm >/dev/null 2>&1; then \
		echo "    ✓ pnpm $$(pnpm --version)"; \
	else \
		echo "    ✗ pnpm [not installed — run make setup]"; \
	fi
	@echo "  Vite+"
	@if [ -f "$$HOME/.vite-plus/env" ]; then \
		echo "    ✓ Vite+ installed"; \
	else \
		echo "    ✗ Vite+ [not installed — run make setup]"; \
	fi
	@echo "  Browser debugging"
	@if claude mcp list 2>/dev/null | grep -q "chrome-devtools"; then \
		echo "    ✓ chrome-devtools MCP"; \
	else \
		echo "    ✗ chrome-devtools MCP [missing — run make setup]"; \
	fi
	@if jq -e '.permissions.allow | contains(["mcp__chrome-devtools__*"])' "$(CLAUDE_DIR)/settings.json" > /dev/null 2>&1; then \
		echo "    ✓ mcp__chrome-devtools__* permission"; \
	else \
		echo "    ✗ mcp__chrome-devtools__* permission [missing]"; \
	fi
	@echo ""

.PHONY: _check
_check:
	@if [ -L "$(DST)" ] && [ -e "$(DST)" ]; then \
		echo "    ✓ $(notdir $(DST))"; \
	elif [ -L "$(DST)" ]; then \
		echo "    ✗ $(notdir $(DST)) [BROKEN]"; \
	elif [ -e "$(DST)" ]; then \
		echo "    ✗ $(notdir $(DST)) [real file — run make setup]"; \
	else \
		echo "    ✗ $(notdir $(DST)) [missing — run make setup]"; \
	fi

# ============================================================================
# GitHub Config — apply branch protection + merge settings to all repos
# ============================================================================

.PHONY: github-config
github-config:
	@chmod +x $(CLAUDE_LOCAL)/scripts/github-config.sh
	@$(CLAUDE_LOCAL)/scripts/github-config.sh

.PHONY: github-config-dry
github-config-dry:
	@chmod +x $(CLAUDE_LOCAL)/scripts/github-config.sh
	@DRY_RUN=1 $(CLAUDE_LOCAL)/scripts/github-config.sh

# ============================================================================
# cqueue — web dashboard (http://cqueue.local)
# ============================================================================

.PHONY: up
up:
	cd cqueue && docker compose up -d --build

.PHONY: down
down:
	cd cqueue && docker compose down

.PHONY: rebuild
rebuild:
	cd cqueue && docker compose up -d --build --force-recreate

.PHONY: logs
logs:
	cd cqueue && docker compose logs -f

.PHONY: shell
shell:
	cd cqueue && docker compose exec cqueue sh

.PHONY: ps
ps:
	cd cqueue && docker compose ps

# ============================================================================
# Help
# ============================================================================

.PHONY: help
help:
	@echo ""
	@echo "  claude-local"
	@echo ""
	@echo "  make setup              Idempotent full setup — symlinks, secrets, settings, browser"
	@echo "  make status             Verify symlink health + Keychain secrets"
	@echo "  make github-config      Apply branch protection + merge settings to all repos"
	@echo "  make github-config-dry  Preview without applying"
	@echo ""
	@echo "  make up         Start cqueue dashboard  (http://cqueue.local)"
	@echo "  make down       Stop cqueue"
	@echo "  make rebuild    Force-recreate cqueue container"
	@echo "  make logs       Tail cqueue logs"
	@echo "  make shell      Shell into cqueue container"
	@echo "  make ps         Container status"
	@echo ""

.DEFAULT_GOAL := help
