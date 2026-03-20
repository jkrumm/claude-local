CLAUDE_LOCAL := $(shell pwd)
CLAUDE_DIR   := $(HOME)/.claude
SOURCEROOT   := $(HOME)/SourceRoot

# ============================================================================
# Setup — create symlinks from ~/.claude/ → claude-local/
# ============================================================================

.PHONY: setup
setup: _symlink-hooks _symlink-scripts _symlink-skills _symlink-gitignore
	@echo ""
	@echo "  Setup complete. Run 'make status' to verify."
	@echo ""

.PHONY: _symlink-hooks
_symlink-hooks:
	@echo "  Linking hooks..."
	@mkdir -p $(CLAUDE_DIR)/hooks
	@$(MAKE) _link SRC=$(CLAUDE_LOCAL)/hooks/notify.ts DST=$(CLAUDE_DIR)/hooks/notify.ts

.PHONY: _symlink-scripts
_symlink-scripts:
	@echo "  Linking scripts..."
	@$(MAKE) _link SRC=$(CLAUDE_LOCAL)/scripts/queue.ts    DST=$(CLAUDE_DIR)/queue.ts
	@$(MAKE) _link SRC=$(CLAUDE_LOCAL)/scripts/statusline.sh DST=$(CLAUDE_DIR)/statusline.sh

.PHONY: _symlink-skills
_symlink-skills:
	@echo "  Linking skills..."
	@mkdir -p $(CLAUDE_DIR)/skills
	@for skill in $(CLAUDE_LOCAL)/skills/*/; do \
		name=$$(basename $$skill); \
		$(MAKE) _link SRC=$$skill DST=$(CLAUDE_DIR)/skills/$$name; \
	done

.PHONY: _symlink-gitignore
_symlink-gitignore:
	@echo "  Configuring global gitignore..."
	@$(MAKE) _link SRC=$(CLAUDE_LOCAL)/config/gitignore_global DST=$(HOME)/.gitignore_global
	@git config --global core.excludesfile $(HOME)/.gitignore_global

# Helper: backup existing file/dir and create symlink
.PHONY: _link
_link:
	@if [ -e "$(DST)" ] && [ ! -L "$(DST)" ]; then \
		echo "    Backing up $(DST) → $(DST).bak"; \
		mv "$(DST)" "$(DST).bak"; \
	fi
	@ln -sfn "$(SRC)" "$(DST)"
	@echo "    ✓ $(DST)"

# ============================================================================
# Status — show current symlink state
# ============================================================================

.PHONY: status
status:
	@echo ""
	@echo "  Symlink status:"
	@$(MAKE) _check-link DST=$(CLAUDE_DIR)/hooks/notify.ts
	@$(MAKE) _check-link DST=$(CLAUDE_DIR)/queue.ts
	@$(MAKE) _check-link DST=$(CLAUDE_DIR)/statusline.sh
	@for skill in $(CLAUDE_LOCAL)/skills/*/; do \
		name=$$(basename $$skill); \
		$(MAKE) _check-link DST=$(CLAUDE_DIR)/skills/$$name; \
	done
	@echo ""

.PHONY: _check-link
_check-link:
	@if [ -L "$(DST)" ]; then \
		echo "    ✓ $(DST) → $$(readlink $(DST))"; \
	elif [ -e "$(DST)" ]; then \
		echo "    ✗ $(DST) [exists but NOT a symlink — run make setup]"; \
	else \
		echo "    ✗ $(DST) [missing — run make setup]"; \
	fi

# ============================================================================
# cqueue Docker operations
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
	@echo "  claude-local Makefile"
	@echo ""
	@echo "  Setup"
	@echo "    make setup      Create all symlinks ~/.claude/* → claude-local/*"
	@echo "    make status     Show symlink health"
	@echo ""
	@echo "  cqueue (web dashboard)"
	@echo "    make up         docker compose up -d --build"
	@echo "    make down       docker compose down"
	@echo "    make rebuild    Force recreate (after code changes)"
	@echo "    make logs       Tail container logs"
	@echo "    make shell      Shell into container"
	@echo "    make ps         Show container status"
	@echo ""
