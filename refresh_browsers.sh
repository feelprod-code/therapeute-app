#!/bin/bash
osascript -e '
if application "Google Chrome" is running then
    tell application "Google Chrome"
        repeat with w in windows
            tell w
                repeat with t in tabs
                    if (URL of t contains "3001" or URL of t contains "3005" or URL of t contains "tdt-micro" or URL of t contains "consultation") then
                        reload t
                    end if
                end repeat
            end tell
        end repeat
    end tell
end if

if application "Safari" is running then
    tell application "Safari"
        repeat with w in windows
            tell w
                repeat with t in tabs
                    if (URL of t contains "3001" or URL of t contains "3005" or URL of t contains "tdt-micro" or URL of t contains "consultation" or URL of t contains "la-seance") then
                        set currentURL to URL of t
                        set URL of t to currentURL
                    end if
                end repeat
            end tell
        end repeat
    end tell
end if
' 2>/dev/null || true
echo "Browsers refreshed."
