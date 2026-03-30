#!/bin/sh
# Runs on wake from sleep via sleepwatcher — re-registers localias mDNS records
localias reload >/dev/null 2>&1
