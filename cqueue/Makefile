dev:
	@lsof -ti :7705 | xargs kill -9 2>/dev/null; true
	@lsof -ti :7706 | xargs kill -9 2>/dev/null; true
	@trap 'kill 0' INT; PORT=7706 bun run dev:server & bun run dev:client; wait

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
