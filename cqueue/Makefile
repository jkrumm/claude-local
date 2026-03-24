dev:
	@echo "Clearing ports :7705 and :7706..."
	@lsof -ti :7705 | xargs kill -9 2>/dev/null; true
	@lsof -ti :7706 | xargs kill -9 2>/dev/null; true
	@echo "Starting dev: Vite on :7705 (HMR) + API on :7706..."
	@PORT=7706 bun --watch server/index.ts & bun run dev:client

start:
	@lsof -ti :7705 | xargs kill -9 2>/dev/null; true
	bun server/index.ts

build:
	bun run build

install-agent:
	cp com.jkrumm.cqueue.plist ~/Library/LaunchAgents/
	launchctl load ~/Library/LaunchAgents/com.jkrumm.cqueue.plist
	@echo "cqueue LaunchAgent installed and started"

uninstall-agent:
	launchctl unload ~/Library/LaunchAgents/com.jkrumm.cqueue.plist
	rm ~/Library/LaunchAgents/com.jkrumm.cqueue.plist
	@echo "cqueue LaunchAgent removed"

.PHONY: dev start build install-agent uninstall-agent
