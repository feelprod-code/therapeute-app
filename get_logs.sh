#!/bin/bash
tail -n 100 /Users/guillaumephilippe/ANTIGRAVITY/therapeute-app/.next/server/pages-manifest.json 2>/dev/null || true
ps aux | grep "npm run dev" | grep -v grep
