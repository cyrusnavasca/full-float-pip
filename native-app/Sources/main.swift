import Cocoa

// MARK: - Application Entry Point

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate

// Run as accessory (no Dock icon)
app.setActivationPolicy(.accessory)

// The panel never activates the app (it must not steal focus from fullscreen
// apps), and macOS ignores cursor changes from inactive apps. This private
// connection property lets us set resize/grab/pointer cursors anyway.
@_silgen_name("_CGSDefaultConnection") func _CGSDefaultConnection() -> Int32
@_silgen_name("CGSSetConnectionProperty")
func CGSSetConnectionProperty(_ cid: Int32, _ target: Int32, _ key: CFString, _ value: CFTypeRef) -> Int32
let cid = _CGSDefaultConnection()
_ = CGSSetConnectionProperty(cid, cid, "SetsCursorInBackground" as CFString, kCFBooleanTrue)
app.run()
