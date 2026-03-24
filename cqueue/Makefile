dev:
	@echo "Clearing ports :7705 and :7706..."
	@lsof -ti :7705 | xargs kill -9 2>/dev/null; true
	@lsof -ti :7706 | xargs kill -9 2>/dev/null; true
	@echo "Starting dev: Vite on :7705 (HMR) + API on :7706..."
	@PORT=7706 bun --watch server/index.ts & bun run dev:client

start: build
	@lsof -ti :7705 | xargs kill -9 2>/dev/null; true
	bun server/index.ts

build:
	bun run build

reload: build
	launchctl kickstart -k gui/$$(id -u)/com.jkrumm.cqueue
	@echo "cqueue reloaded"

install-agent: build
	cp com.jkrumm.cqueue.plist ~/Library/LaunchAgents/
	launchctl load ~/Library/LaunchAgents/com.jkrumm.cqueue.plist
	@echo "cqueue LaunchAgent installed and started"

uninstall-agent:
	launchctl unload ~/Library/LaunchAgents/com.jkrumm.cqueue.plist
	rm ~/Library/LaunchAgents/com.jkrumm.cqueue.plist
	@echo "cqueue LaunchAgent removed"

.PHONY: dev start build reload install-agent uninstall-agent
