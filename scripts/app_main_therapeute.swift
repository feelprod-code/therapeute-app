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

        // 2. Fenêtre principale macOS calée au format iPhone
        let windowWidth: CGFloat = 440
        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let windowHeight: CGFloat = min(screenRect.height - 60, 920)
        
        let rect = NSRect(
            x: screenRect.origin.x + screenRect.width - windowWidth - 40,
            y: screenRect.origin.y + (screenRect.height - windowHeight) / 2,
            width: windowWidth,
            height: windowHeight
        )

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "TDT Thérapeute"
        window.delegate = self
        window.minSize = NSSize(width: 380, height: 550)
        window.maxSize = NSSize(width: 600, height: 1400)
        window.setFrameAutosaveName("TDTTherapeutePhoneWindow")
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

        // 3. Menu Affichage (Rechargement rapide)
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "Affichage")
        viewMenuItem.submenu = viewMenu

        let reloadItem = viewMenu.addItem(withTitle: "Recharger la page", action: #selector(reloadApp), keyEquivalent: "r")
        reloadItem.keyEquivalentModifierMask = [.command]
        reloadItem.target = self

        // 4. Menu Fenêtre
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Fenêtre")
        windowMenuItem.submenu = windowMenu

        let minItem = windowMenu.addItem(withTitle: "Réduire", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        minItem.keyEquivalentModifierMask = [.command]

        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        
        let closeItem = windowMenu.addItem(withTitle: "Fermer la fenêtre", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        closeItem.keyEquivalentModifierMask = [.command]

        NSApp.mainMenu = mainMenu
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

    // Gestion des liens target="_blank"
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }

    // Réessai automatique si échec provisoire
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.loadApp()
        }
    }

    func windowWillClose(_ notification: Notification) {
        NSApplication.shared.terminate(nil)
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
