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
        
        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.uiDelegate = self
        webView.navigationDelegate = self
        window.contentView?.addSubview(webView)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // 4. Charger l'URL locale
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
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
