CLAUDE_LOCAL := $(shell pwd)
CLAUDE_DIR   := $(HOME)/.claude
SOURCEROOT   := $(HOME)/SourceRoot

# ============================================================================
# Setup — create symlinks from ~/.claude/ and ~/SourceRoot/ → claude-local/
#
# Idempotent: safe to run on a fresh machine or re-run after changes.
# Existing plain files are backed up to <file>.bak before being replaced.
# ============================================================================

.PHONY: setup
setup:
	@echo ""
	@echo "  Setting up claude-local symlinks..."
	@echo ""
	@$(MAKE) --no-print-directory _setup-config
	@$(MAKE) --no-print-directory _setup-hooks
	@$(MAKE) --no-print-directory _setup-scripts
	@$(MAKE) --no-print-directory _setup-global-skills
	@$(MAKE) --no-print-directory _setup-sourceroot-skills
	@$(MAKE) --no-print-directory _setup-gitignore
	@echo ""
	@echo "  Done. Run 'make status' to verify all symlinks."
	@echo ""

.PHONY: _setup-config
_setup-config:
	@echo "  Config (CLAUDE.md files)..."
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/global.CLAUDE.md" \
		DST="$(CLAUDE_DIR)/CLAUDE.md"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/sourceroot.CLAUDE.md" \
		DST="$(SOURCEROOT)/CLAUDE.md"

.PHONY: _setup-hooks
_setup-hooks:
	@echo "  Hooks..."
	@mkdir -p $(CLAUDE_DIR)/hooks
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/hooks/notify.ts" \
		DST="$(CLAUDE_DIR)/hooks/notify.ts"

.PHONY: _setup-scripts
_setup-scripts:
	@echo "  Scripts..."
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/scripts/queue.ts" \
		DST="$(CLAUDE_DIR)/queue.ts"
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/scripts/statusline.sh" \
		DST="$(CLAUDE_DIR)/statusline.sh"

.PHONY: _setup-global-skills
_setup-global-skills:
	@echo "  Global skills (~/.claude/skills/)..."
	@mkdir -p $(CLAUDE_DIR)/skills
	@for skill in $(CLAUDE_LOCAL)/skills/global/*/; do \
		name=$$(basename "$$skill"); \
		$(MAKE) --no-print-directory _link SRC="$$skill" DST="$(CLAUDE_DIR)/skills/$$name"; \
	done

.PHONY: _setup-sourceroot-skills
_setup-sourceroot-skills:
	@echo "  SourceRoot skills (~/SourceRoot/.claude/skills/)..."
	@mkdir -p $(SOURCEROOT)/.claude/skills
	@for skill in $(CLAUDE_LOCAL)/skills/sourceroot/*/; do \
		name=$$(basename "$$skill"); \
		$(MAKE) --no-print-directory _link SRC="$$skill" DST="$(SOURCEROOT)/.claude/skills/$$name"; \
	done

.PHONY: _setup-gitignore
_setup-gitignore:
	@echo "  Global gitignore..."
	@$(MAKE) --no-print-directory _link \
		SRC="$(CLAUDE_LOCAL)/config/gitignore_global" \
		DST="$(HOME)/.gitignore_global"
	@git config --global core.excludesfile "$(HOME)/.gitignore_global"
	@echo "    ✓ git config core.excludesfile set"

# Helper: backup existing real file/dir and create symlink.
# No-op if symlink already points to the right place.
.PHONY: _link
_link:
	@if [ -L "$(DST)" ] && [ "$$(readlink $(DST))" = "$(SRC)" ]; then \
		echo "    · $(notdir $(DST)) (already linked)"; \
	else \
		if [ -e "$(DST)" ] && [ ! -L "$(DST)" ]; then \
			echo "    Backing up $(DST) → $(DST).bak"; \
			mv "$(DST)" "$(DST).bak"; \
		fi; \
		ln -sfn "$(SRC)" "$(DST)"; \
		echo "    ✓ $(DST)"; \
	fi

# ============================================================================
# Status — verify all symlinks resolve correctly
# ============================================================================

.PHONY: status
status:
	@echo ""
	@echo "  Symlink health:"
	@echo ""
	@echo "  Config"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/CLAUDE.md"
	@$(MAKE) --no-print-directory _check DST="$(SOURCEROOT)/CLAUDE.md"
	@echo "  Hooks"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/hooks/notify.ts"
	@echo "  Scripts"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/queue.ts"
	@$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/statusline.sh"
	@echo "  Gitignore"
	@$(MAKE) --no-print-directory _check DST="$(HOME)/.gitignore_global"
	@echo "  Global skills"
	@for skill in $(CLAUDE_LOCAL)/skills/global/*/; do \
		name=$$(basename "$$skill"); \
		$(MAKE) --no-print-directory _check DST="$(CLAUDE_DIR)/skills/$$name"; \
	done
	@echo "  SourceRoot skills"
	@for skill in $(CLAUDE_LOCAL)/skills/sourceroot/*/; do \
		name=$$(basename "$$skill"); \
		$(MAKE) --no-print-directory _check DST="$(SOURCEROOT)/.claude/skills/$$name"; \
	done
	@echo ""

.PHONY: _check
_check:
	@if [ -L "$(DST)" ] && [ -e "$(DST)" ]; then \
		echo "    ✓ $(notdir $(DST))"; \
	elif [ -L "$(DST)" ]; then \
		echo "    ✗ $(notdir $(DST)) [BROKEN SYMLINK]"; \
	elif [ -e "$(DST)" ]; then \
		echo "    ✗ $(notdir $(DST)) [real file — run make setup to convert]"; \
	else \
		echo "    ✗ $(notdir $(DST)) [missing — run make setup]"; \
	fi

# ============================================================================
# cqueue — web dashboard (Docker)
# ============================================================================

.PHONY: up
up:
	cd cqueue && docker compose --env-file ../.env up -d --build

.PHONY: down
down:
	cd cqueue && docker compose down

.PHONY: rebuild
rebuild:
	cd cqueue && docker compose --env-file ../.env up -d --build --force-recreate

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
	@echo "  make setup      Symlink all config/hooks/scripts/skills into place"
	@echo "  make status     Verify symlink health"
	@echo ""
	@echo "  make up         Start cqueue web dashboard"
	@echo "  make down       Stop cqueue"
	@echo "  make rebuild    Force-recreate cqueue container"
	@echo "  make logs       Tail cqueue logs"
	@echo "  make shell      Shell into cqueue container"
	@echo "  make ps         Show container status"
	@echo ""

.DEFAULT_GOAL := help
