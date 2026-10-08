#!/bin/bash
set -e

APP_PATH="/Applications/TDT Thérapeute.app"
SWIFT_SRC="/Users/guillaumephilippe/ANTIGRAVITY/therapeute-app/scripts/app_main_therapeute.swift"

echo "1. Stopping any running TDT Thérapeute..."
osascript -e 'quit app "TDT Thérapeute"' 2>/dev/null || true
pkill -f "TDTTherapeute" 2>/dev/null || true
pkill -f "TDT Thérapeute" 2>/dev/null || true
pkill -f "applet" 2>/dev/null || true
sleep 1

echo "2. Compiling Swift wrapper to app bundle..."
mkdir -p "$APP_PATH/Contents/MacOS"
swiftc -O "$SWIFT_SRC" -o "$APP_PATH/Contents/MacOS/TDTTherapeute_bin"
chmod +x "$APP_PATH/Contents/MacOS/TDTTherapeute_bin"

cat << 'EOF' > "$APP_PATH/Contents/MacOS/TDTTherapeute"
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/TDTTherapeute_bin" "$@"
EOF
chmod +x "$APP_PATH/Contents/MacOS/TDTTherapeute"

echo "3. Cleaning attributes & Code signing..."
rm -rf "$APP_PATH/Contents/_CodeSignature"
xattr -cr "$APP_PATH"
codesign --force -s - "$APP_PATH/Contents/MacOS/TDTTherapeute_bin"
codesign --force -s - "$APP_PATH"

echo "4. Registering with LaunchServices..."
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -R -f "$APP_PATH" || true

echo "5. Resetting old window preferences..."
defaults delete com.feelprod.tdt-therapeute "NSWindow Frame TDTTherapeutePhoneWindow" 2>/dev/null || true
defaults delete com.feelprod.tdt-therapeute "NSWindow Frame TDTTherapeuteMainWindow" 2>/dev/null || true

echo "✅ App rebuilt and signed successfully!"
