APP_NAME = WeatherWallpaper
# Built outside iCloud on purpose: iCloud puts com.apple.FinderInfo on the
# bundle, which codesign rejects, and an unsigned-with-plist bundle never gets
# a location permission prompt from TCC.
BUILD_DIR ?= $(HOME)/Library/Caches/weather-wallpaper-build
APP_BUNDLE = $(BUILD_DIR)/$(APP_NAME).app
CONTENTS = $(APP_BUNDLE)/Contents
MACOS = $(CONTENTS)/MacOS
RESOURCES = $(CONTENTS)/Resources

SWIFT_FILES = \
	WeatherWallpaper/main.swift \
	WeatherWallpaper/AppDelegate.swift \
	WeatherWallpaper/DesktopWindowManager.swift \
	WeatherWallpaper/LocationManager.swift \
	WeatherWallpaper/OpenSkyClient.swift \
	WeatherWallpaper/GribDecoder.swift \
	WeatherWallpaper/WindService.swift \
	WeatherWallpaper/SettingsWindow.swift

FRAMEWORKS = -framework Cocoa -framework WebKit -framework CoreLocation -framework ServiceManagement
SWIFT_FLAGS = -target arm64-apple-macosx13.0

.PHONY: all clean run install test

all: $(APP_BUNDLE)

$(APP_BUNDLE): $(SWIFT_FILES) WeatherWallpaper/Web/* WeatherWallpaper/Info.plist
	@node test/smoke.js
	@mkdir -p $(MACOS) $(RESOURCES)/Web
	swiftc $(SWIFT_FLAGS) $(FRAMEWORKS) -o $(MACOS)/$(APP_NAME) $(SWIFT_FILES)
	@# Info.plist with resolved variables
	@sed -e 's/$$(EXECUTABLE_NAME)/$(APP_NAME)/g' \
	     -e 's/$$(PRODUCT_BUNDLE_IDENTIFIER)/com.weatherwallpaper.app/g' \
	     -e 's/$$(PRODUCT_NAME)/Weather Wallpaper/g' \
	     -e 's/$$(MACOSX_DEPLOYMENT_TARGET)/13.0/g' \
	     WeatherWallpaper/Info.plist > $(CONTENTS)/Info.plist
	@cp -R WeatherWallpaper/Web/* $(RESOURCES)/Web/
	@# iCloud leaves xattrs and .DS_Store inside the bundle, which codesign
	@# rejects as "resource fork, Finder information, or similar detritus".
	@find $(APP_BUNDLE) -name '.DS_Store' -delete
	@xattr -d com.apple.FinderInfo $(APP_BUNDLE) 2>/dev/null || true
	@xattr -d com.apple.FinderInfo $(CONTENTS) 2>/dev/null || true
	@# Sign with the real bundle id and entitlements. Without this the linker's
	@# ad-hoc signature leaves Info.plist unbound, so TCC never sees
	@# NSLocationWhenInUseUsageDescription and the location prompt never appears.
	@codesign --force --sign - \
		--identifier com.weatherwallpaper.app \
		--entitlements WeatherWallpaper/WeatherWallpaper.entitlements \
		$(APP_BUNDLE)
	@echo "Built: $(APP_BUNDLE)"

test:
	@node test/smoke.js

run: $(APP_BUNDLE)
	open $(APP_BUNDLE)

clean:
	rm -rf $(BUILD_DIR)

# Replace the copy in /Applications, which is what Spotlight and the Dock
# launch. Building alone leaves that copy stale, which silently hides every
# change behind an old binary.
install: $(APP_BUNDLE)
	@pkill -x $(APP_NAME) 2>/dev/null || true
	@sleep 1
	@rm -rf /Applications/$(APP_NAME).app
	@ditto $(APP_BUNDLE) /Applications/$(APP_NAME).app
	@xattr -d com.apple.FinderInfo /Applications/$(APP_NAME).app 2>/dev/null || true
	@codesign --force --sign - \
		--identifier com.weatherwallpaper.app \
		--entitlements WeatherWallpaper/WeatherWallpaper.entitlements \
		/Applications/$(APP_NAME).app
	@echo "Installed: /Applications/$(APP_NAME).app"
	@open /Applications/$(APP_NAME).app
