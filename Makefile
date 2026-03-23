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
	@$(MAKE) --no-print-directory _setup-config
	@$(MAKE) --no-print-directory _setup-hooks
	@$(MAKE) --no-print-directory _setup-scripts
	@$(MAKE) --no-print-directory _setup-skills
	@$(MAKE) --no-print-directory _setup-settings
	@$(MAKE) --no-print-directory _setup-gitignore
	@$(MAKE) --no-print-directory _setup-browser
	@echo ""
	@echo "  Done. Run 'make status' to verify."
	@echo ""

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
			'del(._NOTE) * {permissions: $$existing[0].permissions} * ($$existing[0] | {model, effortLevel, alwaysThinkingEnabled} | with_entries(select(.value != null))) * {mcpServers: (($$existing[0].mcpServers // {}) + .mcpServers)}' \
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

.PHONY: _setup-browser
_setup-browser:
	@echo "  Browser debugging (Chrome DevTools MCP)..."
	@if jq -e '.mcpServers["chrome-devtools"]' "$(CLAUDE_DIR)/settings.json" > /dev/null 2>&1; then \
		echo "    · chrome-devtools MCP (ok)"; \
	else \
		echo "    ✗ chrome-devtools MCP missing — run make setup to add via template merge"; \
	fi
	@if jq -e '.permissions.allow | contains(["mcp__chrome-devtools__*"])' "$(CLAUDE_DIR)/settings.json" > /dev/null 2>&1; then \
		echo "    · mcp__chrome-devtools__* permission (ok)"; \
	else \
		jq '.permissions.allow += ["mcp__chrome-devtools__*"]' "$(CLAUDE_DIR)/settings.json" > /tmp/claude-browser-perm.json \
		&& mv /tmp/claude-browser-perm.json "$(CLAUDE_DIR)/settings.json"; \
		echo "    ✓ mcp__chrome-devtools__* permission added to live settings"; \
	fi
	@echo "    · chrome-debug alias (via zshrc symlink)"
	@if ! command -v npx > /dev/null 2>&1; then \
		echo "    ✗ npx not found — install Node.js for Chrome for Testing support"; \
	else \
		echo "    · npx available (run: npx playwright install chrome — for Chrome for Testing)"; \
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
	@echo "  Symlink health:"
	@echo ""
	@echo "  Config"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/CLAUDE.md"
	@$(MAKE) --no-print-directory _check DST="$(SOURCEROOT)/CLAUDE.md"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.zshrc"
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
	@echo "  Skills ($(shell ls $(CLAUDE_LOCAL)/skills/ | wc -l | xargs) — SourceRoot only)"
	@for skill in $(CLAUDE_LOCAL)/skills/*/; do \
		name=$$(basename "$$skill"); \
		$(MAKE) --no-print-directory _check DST="$(SOURCEROOT)/.claude/skills/$$name"; \
	done
	@echo "  Browser debugging"
	@if jq -e '.mcpServers["chrome-devtools"]' "$(CLAUDE_DIR)/settings.json" > /dev/null 2>&1; then \
		echo "    ✓ chrome-devtools MCP (in settings.json)"; \
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
	@echo "  make setup           Symlink all config/hooks/scripts/skills into place"
	@echo "  make status          Verify symlink health"
	@echo "  make github-config   Apply branch protection + merge settings to all repos"
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
