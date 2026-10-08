import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKUIDelegate, WKNavigationDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Empêcher AppKit de fermer l'application automatiquement
        ProcessInfo.processInfo.disableAutomaticTermination("TDT Thérapeute permanent runtime")
        ProcessInfo.processInfo.disableSuddenTermination()

        // 1. Démarrer / vérifier le serveur local
        let scriptPath = "/Users/guillaumephilippe/ANTIGRAVITY/therapeute-app/scripts/start_therapeute_app.sh"
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/bash")
        proc.arguments = [scriptPath]
        try? proc.run()
        proc.waitUntilExit()

        // 2. Fenêtre principale macOS - redimensionnable sans restriction et plein écran
        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let defaultWidth: CGFloat = min(max(screenRect.width * 0.70, 1100), 1400)
        let defaultHeight: CGFloat = min(screenRect.height - 60, 960)
        
        let rect = NSRect(
            x: screenRect.origin.x + (screenRect.width - defaultWidth) / 2,
            y: screenRect.origin.y + (screenRect.height - defaultHeight) / 2,
            width: defaultWidth,
            height: defaultHeight
        )

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "TDT Thérapeute"
        window.delegate = self
        window.minSize = NSSize(width: 380, height: 500)
        // Aucune limite maximale pour permettre le redimensionnement libre et le plein écran
        window.collectionBehavior = [.fullScreenPrimary, .fullScreenAllowsTiling]
        window.setFrameAutosaveName("TDTTherapeuteMainWindow")
        window.isReleasedWhenClosed = false

        // 3. Configuration WKWebView avec permission Micro
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        
        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        window.contentView?.addSubview(webView)

        // Configurer le menu principal macOS (Copier / Coller / Sélectionner / Recharger)
        setupMainMenu()

        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(webView)
        NSApp.activate(ignoringOtherApps: true)

        // 4. Charger l'URL locale
        loadApp()
    }

    func setupMainMenu() {
        let mainMenu = NSMenu()

        // 1. Menu Application
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenuItem.submenu = appMenu

        let appName = "TDT Thérapeute"
        appMenu.addItem(withTitle: "À propos de \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        
        let hideItem = appMenu.addItem(withTitle: "Masquer \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        hideItem.keyEquivalentModifierMask = [.command]
        
        let hideOthersItem = appMenu.addItem(withTitle: "Masquer les autres", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        
        appMenu.addItem(withTitle: "Tout afficher", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        
        let quitItem = appMenu.addItem(withTitle: "Quitter \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quitItem.keyEquivalentModifierMask = [.command]

        // 2. Menu Édition (INDISPENSABLE pour Cmd+C, Cmd+V, Cmd+X, Cmd+A dans WKWebView)
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Édition")
        editMenuItem.submenu = editMenu

        let undoItem = editMenu.addItem(withTitle: "Annuler", action: #selector(UndoManager.undo), keyEquivalent: "z")
        undoItem.keyEquivalentModifierMask = [.command]

        let redoItem = editMenu.addItem(withTitle: "Rétablir", action: #selector(UndoManager.redo), keyEquivalent: "Z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]

        editMenu.addItem(NSMenuItem.separator())

        let cutItem = editMenu.addItem(withTitle: "Couper", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        cutItem.keyEquivalentModifierMask = [.command]

        let copyItem = editMenu.addItem(withTitle: "Copier", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        copyItem.keyEquivalentModifierMask = [.command]

        let pasteItem = editMenu.addItem(withTitle: "Coller", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        pasteItem.keyEquivalentModifierMask = [.command]

        let selectAllItem = editMenu.addItem(withTitle: "Tout sélectionner", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        selectAllItem.keyEquivalentModifierMask = [.command]

        // 3. Menu Affichage (Rechargement rapide & Plein écran)
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "Affichage")
        viewMenuItem.submenu = viewMenu

        let reloadItem = viewMenu.addItem(withTitle: "Recharger la page", action: #selector(reloadApp), keyEquivalent: "r")
        reloadItem.keyEquivalentModifierMask = [.command]
        reloadItem.target = self

        viewMenu.addItem(NSMenuItem.separator())

        let fullScreenItem = viewMenu.addItem(withTitle: "Activer le mode plein écran", action: #selector(toggleFullScreen), keyEquivalent: "f")
        fullScreenItem.keyEquivalentModifierMask = [.command, .control]
        fullScreenItem.target = self

        // 4. Menu Fenêtre (Redimensionnement & Formats)
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Fenêtre")
        windowMenuItem.submenu = windowMenu

        let minItem = windowMenu.addItem(withTitle: "Réduire", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        minItem.keyEquivalentModifierMask = [.command]

        windowMenu.addItem(withTitle: "Zoomer / Maximiser", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        
        windowMenu.addItem(NSMenuItem.separator())
        
        let deskItem = windowMenu.addItem(withTitle: "Format Grand Écran (1200 px)", action: #selector(setDesktopSize), keyEquivalent: "2")
        deskItem.keyEquivalentModifierMask = [.command, .option]
        deskItem.target = self

        let phoneItem = windowMenu.addItem(withTitle: "Format Mobile (440 px)", action: #selector(setPhoneSize), keyEquivalent: "1")
        phoneItem.keyEquivalentModifierMask = [.command, .option]
        phoneItem.target = self

        windowMenu.addItem(NSMenuItem.separator())

        let closeItem = windowMenu.addItem(withTitle: "Fermer la fenêtre", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        closeItem.keyEquivalentModifierMask = [.command]

        NSApp.mainMenu = mainMenu
    }

    @objc func toggleFullScreen() {
        window.toggleFullScreen(nil)
    }

    @objc func setDesktopSize() {
        let screen = window.screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let w: CGFloat = min(max(screen.width * 0.70, 1100), 1400)
        let h: CGFloat = min(screen.height - 60, 960)
        let frame = NSRect(
            x: screen.origin.x + (screen.width - w) / 2,
            y: screen.origin.y + (screen.height - h) / 2,
            width: w,
            height: h
        )
        window.setFrame(frame, display: true, animate: true)
    }

    @objc func setPhoneSize() {
        let screen = window.screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let w: CGFloat = 440
        let h: CGFloat = min(screen.height - 60, 920)
        let frame = NSRect(
            x: screen.origin.x + screen.width - w - 40,
            y: screen.origin.y + (screen.height - h) / 2,
            width: w,
            height: h
        )
        window.setFrame(frame, display: true, animate: true)
    }

    @objc func reloadApp() {
        loadApp()
    }

    func loadApp() {
        if let targetURL = URL(string: "http://localhost:3001") {
            let request = URLRequest(url: targetURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
            webView.load(request)
        }
    }

    // Autoriser le micro sans popup de confirmation
    @available(macOS 12.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

    // Ouvrir le sélecteur de fichiers macOS natif (NSOpenPanel) lors d'un clic sur <input type="file">
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let openPanel = NSOpenPanel()
        openPanel.allowsMultipleSelection = parameters.allowsMultipleSelection
        openPanel.canChooseDirectories = parameters.allowsDirectories
        openPanel.canChooseFiles = true
        openPanel.canCreateDirectories = false
        openPanel.resolvesAliases = true
        openPanel.title = "Sélectionner un document ou un compte-rendu"
        openPanel.prompt = "Sélectionner"
        
        let targetWindow = webView.window ?? self.window ?? NSApp.keyWindow
        if let win = targetWindow, win.attachedSheet == nil {
            openPanel.beginSheetModal(for: win) { response in
                completionHandler(response == .OK ? openPanel.urls : nil)
            }
        } else {
            openPanel.begin { response in
                completionHandler(response == .OK ? openPanel.urls : nil)
            }
        }
    }

    // Gestion des alertes et confirmations JavaScript
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Annuler")
        let response = alert.runModal()
        completionHandler(response == .alertFirstButtonReturn)
    }

    var childWindows: [NSWindow] = []

    // Gestion des liens target="_blank" et fenêtres pop-up (Examens, Radios HD, Liens externes)
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let childWidth: CGFloat = min(max(screenRect.width * 0.85, 1100), 1500)
        let childHeight: CGFloat = min(screenRect.height - 40, 960)
        
        let childRect = NSRect(
            x: screenRect.origin.x + (screenRect.width - childWidth) / 2,
            y: screenRect.origin.y + (screenRect.height - childHeight) / 2,
            width: childWidth,
            height: childHeight
        )

        let childWindow = NSWindow(
            contentRect: childRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        childWindow.title = "Examen / Radio HD — TDT Thérapeute"
        childWindow.minSize = NSSize(width: 480, height: 400)
        childWindow.collectionBehavior = [.fullScreenPrimary, .fullScreenAllowsTiling]
        childWindow.isReleasedWhenClosed = false
        childWindow.delegate = self

        let childWebView = WKWebView(frame: childWindow.contentView!.bounds, configuration: configuration)
        childWebView.autoresizingMask = [.width, .height]
        childWebView.uiDelegate = self
        childWebView.navigationDelegate = self
        childWindow.contentView?.addSubview(childWebView)

        childWindows.append(childWindow)
        childWindow.makeKeyAndOrderFront(nil)
        childWindow.makeFirstResponder(childWebView)
        NSApp.activate(ignoringOtherApps: true)

        if let req = navigationAction.request.url != nil ? navigationAction.request : nil {
            childWebView.load(req)
        }

        return childWebView
    }

    func webViewDidClose(_ webView: WKWebView) {
        if let win = webView.window {
            childWindows.removeAll(where: { $0 == win })
            win.close()
        }
    }

    // Réessai automatique si échec provisoire
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.loadApp()
        }
    }

    func windowWillClose(_ notification: Notification) {
        if let closingWin = notification.object as? NSWindow {
            if closingWin == window {
                NSApplication.shared.terminate(nil)
            } else {
                childWindows.removeAll(where: { $0 == closingWin })
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            window.makeKeyAndOrderFront(nil)
        }
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
