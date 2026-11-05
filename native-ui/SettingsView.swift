import SwiftUI
import AppKit

extension Model {
    var host: [String: Any] { snapshot["host"] as? [String: Any] ?? [:] }
    var prefs: [String: Any] { snapshot["composerPrefs"] as? [String: Any] ?? [:] }
    var shortcuts: [String: Any] { snapshot["shortcuts"] as? [String: Any] ?? [:] }
    var recipients: [[String: Any]] { snapshot["recipients"] as? [[String: Any]] ?? [] }
    var currentRecipient: [String: Any] { recipients.first { ($0["botId"] as? String) == settingsBot } ?? [:] }
    func setting(_ method: String, _ params: [String: Any] = [:]) { settingsMessage = ""; emit("settingsAction", ["method": method, "params": params]) }
    func configure(_ patch: [String: Any]) { if !settingsBot.isEmpty { setting("configure", ["botId": settingsBot, "patch": patch]) } }
    func shortcut(_ slot: String) -> String {
        if slot == "compose" || slot == "open" || slot == "wheel" || slot == "screenshot" { return shortcuts[slot] as? String ?? "" }
        if slot.hasPrefix("grok:") { return (shortcuts["opens"] as? [String: String])?[String(slot.dropFirst(5))] ?? "" }
        return (shortcuts["bots"] as? [String: String])?[slot] ?? ""
    }
}
private struct CompactBotSettingsKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    var compactBotSettings: Bool { get { self[CompactBotSettingsKey.self] } set { self[CompactBotSettingsKey.self] = newValue } }
}
struct SettingLine<Control: View>: View {
    @Environment(\.compactBotSettings) private var compact
    let title: String; var subtitle: String = ""; @ViewBuilder var control: () -> Control
    var body: some View {
        Group {
            if compact {
                VStack(alignment: .leading, spacing: 7) { label; control().frame(maxWidth: .infinity, alignment: .leading) }
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(alignment: .center, spacing: 20) { label; Spacer(minLength: 20); control() }
            }
        }.padding(.vertical, 7)
    }
    var label: some View {
        VStack(alignment: .leading, spacing: 4) { Text(title).font(.body.weight(.medium)); if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) } }
    }
}
struct SettingsView: View {
    @ObservedObject var model: Model
    @State private var tab = "general"
    let tabs: [(String, String, String)] = [("general", "通用", "slider.horizontal.3"), ("shortcuts", "快捷键", "keyboard"), ("wheel", "快捷轮盘", "circle.grid.cross"), ("floating", "桌面悬浮球", "circle.dotted"), ("history", "发送记录", "clock.arrow.circlepath")]
    var title: String { tabs.first(where: { $0.0 == tab })?.1 ?? "设置" }
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text("GrokBot Quick").font(.system(size: 13, weight: .semibold)).padding(.leading, 12).padding(.top, 48).padding(.bottom, 18)
                ForEach(tabs, id: \.0) { entry in
                    Button { tab = entry.0 } label: { Label(entry.1, systemImage: entry.2).font(.system(size: 13, weight: tab == entry.0 ? .semibold : .regular)).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 9).background(tab == entry.0 ? Color.accentColor.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 9)) }.buttonStyle(.plain)
                }
                Spacer()
            }.padding(.horizontal, 12).frame(width: 190).background(.bar)
            Divider()
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.system(size: 24, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 28).padding(.top, 35).padding(.bottom, 18)
                Divider()
                ScrollView { VStack(alignment: .leading, spacing: 18) {
                    if !model.settingsMessage.isEmpty { Text(model.settingsMessage).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                    if model.host["issue"] as? String == "SHORTCUT_UNAVAILABLE" { Text("快捷键不可用或被占用，请重新设置。").font(.callout).foregroundStyle(.orange) }
                    switch tab {
                    case "shortcuts": ShortcutSettings(model: model)
                    case "wheel": WheelLayoutSettings(model: model)
                    case "floating": FloatingSettings(model: model)
                    case "history": HistorySettings(model: model)
                    default: GeneralSettings(model: model); ComposerSettings(model: model)
                    }
                }.frame(maxWidth: 620, alignment: .leading).padding(28).frame(maxWidth: .infinity, alignment: .leading) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        }.frame(minWidth: 700, minHeight: 500)
    }
}
struct FloatingSettings: View {
    @ObservedObject var model: Model
    var current: Bot? { model.bots.first { $0.id == model.floatingBotId } }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 14) {
                ZStack { Circle().fill(Color.accentColor.opacity(0.10)).frame(width: 58, height: 58); if let bot = current { BotAvatar(model: model, bot: bot, size: 44) } else { Image(systemName: "person.crop.circle").font(.system(size: 30)).foregroundStyle(.secondary) } }
                VStack(alignment: .leading, spacing: 4) { Text(current?.name ?? "桌面悬浮球").font(.system(size: 15, weight: .semibold)); Text("拖入文件，让 Bot 按你的提示词处理。") .font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Toggle("桌面悬浮球", isOn: Binding(get: { model.floatingVisible }, set: { value in if value != model.floatingVisible { model.onFloating?() } })).labelsHidden().toggleStyle(.switch)
            }.padding(16).background(Color.accentColor.opacity(0.055), in: RoundedRectangle(cornerRadius: 16))
            GroupBox { VStack(spacing: 0) {
                SettingLine(title: "默认 Bot", subtitle: "点击悬浮球时打开这个对话。") { Picker("默认 Bot", selection: $model.floatingBotId) { Text("选择 Bot").tag(""); ForEach(model.bots) { bot in Text(bot.name).tag(bot.id) } }.labelsHidden().frame(width: 180).onChange(of: model.floatingBotId) { _ in model.saveFloating() } }
                Divider()
                SettingLine(title: "透明度", subtitle: "调整悬浮球与桌面的融合程度。") { Slider(value: $model.floatingOpacity, in: 0.35...1).frame(width: 180).onChange(of: model.floatingOpacity) { _ in model.saveFloating(); model.onFloatingLayout?() } }
            }.padding(4) }
            VStack(alignment: .leading, spacing: 8) {
                HStack { Image(systemName: "text.quote").foregroundStyle(Color.accentColor); Text("文件处理提示词").font(.body.weight(.semibold)) }
                Text("拖入文件后，会使用这段提示词直接派发给所选 Bot。") .font(.caption).foregroundStyle(.secondary)
                TextField("例如：请阅读文件，提炼重点并列出下一步行动。", text: $model.floatingPrompt, axis: .vertical).lineLimit(4...7).textFieldStyle(.plain).font(.system(size: 13)).padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 13)).overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Color.primary.opacity(0.07))).onChange(of: model.floatingPrompt) { _ in model.saveFloating() }
            }
        }
    }
}
struct WheelLayoutSettings: View {
    @ObservedObject var model: Model
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("从正上方开始，按顺时针排列。留空的位置不会触发对话。") .font(.callout).foregroundStyle(.secondary)
            ring("inner", label: "内圈", subtitle: "6 个位置", count: 6)
            ring("outer", label: "外圈", subtitle: "7 个位置", count: 7)
        }
    }
    func ring(_ ring: String, label: String, subtitle: String, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text(label).font(.headline); Text(subtitle).font(.caption).foregroundStyle(.secondary); Spacer(); Image(systemName: ring == "inner" ? "circle.dashed.inset.filled" : "circle.dashed").foregroundStyle(Color.accentColor.opacity(0.7)) }
            VStack(spacing: 0) { ForEach(0..<count, id: \.self) { index in
                HStack(spacing: 10) {
                    Text("\(index + 1)").font(.system(size: 11, weight: .semibold, design: .rounded)).foregroundStyle(Color.accentColor).frame(width: 25, height: 25).background(Color.accentColor.opacity(0.09), in: Circle())
                    Text(index == 0 ? "正上方" : "位置 \(index + 1)").font(.callout).foregroundStyle(index == 0 ? Color.primary : Color.secondary)
                    Spacer()
                    Picker("位置 \(index + 1)", selection: Binding(get: { (model.snapshot["wheelLayout"] as? [String: [String]])?[ring].flatMap { $0.indices.contains(index) ? $0[index] : nil } ?? "" }, set: { model.setting("setWheelSlot", ["ring": ring, "index": index, "botId": $0]) })) { Text("未设置").tag(""); ForEach(model.bots) { bot in Text(bot.name).tag(bot.id) } }.labelsHidden().frame(width: 185)
                }.padding(.vertical, 7)
                if index < count - 1 { Divider().padding(.leading, 35) }
            } }
        }.padding(16).background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 16))
    }
}
struct GeneralSettings: View {
    @ObservedObject var model: Model
    var body: some View {
        VStack(spacing: 14) {
            GroupBox { VStack(spacing: 0) {
                SettingLine(title: (model.snapshot["account"] as? [String: Any])?["name"] as? String ?? "尚未连接", subtitle: (model.snapshot["connected"] as? Bool ?? false) ? "账号已连接" : "登录后同步 Bot") {
                    if model.snapshot["connected"] as? Bool ?? false { HStack { Button("同步") { model.setting("refresh") }; Button("退出") { model.setting("logout") } } }
                    else { HStack { Button("连接账号") { model.setting("login") }; Button("本机登录") { model.setting("desktopLogin") } } }
                }; Divider()
                SettingLine(title: "开机自启动", subtitle: "登录这台电脑后在后台打开。") { Toggle("开机自启动", isOn: Binding(get: { model.host["openAtLogin"] as? Bool ?? false }, set: { model.setting("setOpenAtLogin", ["enabled": $0]) })).labelsHidden().toggleStyle(.switch) }
            }.padding(4) }
            GroupBox { SettingLine(title: "外观") { Picker("外观", selection: Binding(get: { model.snapshot["theme"] as? String ?? "system" }, set: { model.setting("theme", ["theme": $0]) })) { Text("系统").tag("system"); Text("浅色").tag("light"); Text("深色").tag("dark") }.pickerStyle(.segmented).labelsHidden().frame(width: 190) }.padding(4) }
        }
    }
}
struct ShortcutSettings: View {
    @ObservedObject var model: Model
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("全局快捷键").font(.headline)
            GroupBox { VStack(spacing: 0) {
                shortcut("快捷轮盘", "在任意应用中呼出轮盘。", "wheel"); Divider()
                shortcut("截图即问", "框选屏幕区域并填写问题。", "screenshot"); Divider()
                shortcut("底部聊天框", "再次按下可关闭。", "compose")
            }.padding(4) }
            Text("Bot 快捷键").font(.headline).padding(.top, 8)
            Text("为常用 Bot 设置快捷键，按下后直接打开对应聊天。") .font(.caption).foregroundStyle(.secondary)
            GroupBox { VStack(spacing: 0) {
                if model.bots.isEmpty { Text("连接账号后设置 Bot 快捷键。").font(.callout).foregroundStyle(.secondary).padding(8) }
                ForEach(model.bots) { bot in shortcut(bot.name, "", bot.id); if bot.id != model.bots.last?.id { Divider() } }
            }.padding(4) }
        }
    }
    func shortcut(_ title: String, _ subtitle: String, _ slot: String) -> some View {
        SettingLine(title: title, subtitle: subtitle) { HStack { ShortcutRecorder(value: model.shortcut(slot), slot: slot, model: model).frame(width: 150, height: 27); Button("清除") { model.setting("setShortcut", ["slot": slot, "accelerator": ""]) } } }
    }
}
func prettyShortcut(_ value: String) -> String {
    let symbols = ["Command": "⌘", "Cmd": "⌘", "CommandOrControl": "⌘", "CmdOrCtrl": "⌘", "Ctrl": "⌃", "Control": "⌃", "Alt": "⌥", "Option": "⌥", "Shift": "⇧", "Space": "Space"]
    return value.split(separator: "+").map { symbols[String($0)] ?? String($0) }.joined(separator: " ")
}
struct ShortcutRecorder: NSViewRepresentable {
    let value: String; let slot: String; let model: Model
    func makeNSView(context: Context) -> ShortcutButton { let button = ShortcutButton(); button.bezelStyle = .rounded; return button }
    func updateNSView(_ view: ShortcutButton, context: Context) { view.slot = slot; view.model = model; if !view.recording { view.title = value.isEmpty ? "录制快捷键" : prettyShortcut(value) } }
}
final class ShortcutButton: NSButton {
    var slot = ""; weak var model: Model?; var recording = false
    override var acceptsFirstResponder: Bool { true }
    override func mouseDown(with event: NSEvent) { recording = true; title = "按下组合键…"; model?.setting("suppressShortcuts", ["on": true]); window?.makeFirstResponder(self) }
    override func keyDown(with event: NSEvent) {
        guard recording else { super.keyDown(with: event); return }
        if event.keyCode == 53 { finish(nil); return }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var parts: [String] = []
        if flags.contains(.command) { parts.append("Command") }; if flags.contains(.control) { parts.append("Ctrl") }; if flags.contains(.option) { parts.append("Alt") }; if flags.contains(.shift) { parts.append("Shift") }
        guard flags.contains(.command) || flags.contains(.control) || flags.contains(.option) else { return }
        let special: [UInt16: String] = [49:"Space",36:"Return",48:"Tab",51:"Backspace",117:"Delete",123:"Left",124:"Right",125:"Down",126:"Up",122:"F1",120:"F2",99:"F3",118:"F4",96:"F5",97:"F6",98:"F7",100:"F8",101:"F9",109:"F10",103:"F11",111:"F12",105:"F13",107:"F14",113:"F15",106:"F16",64:"F17",79:"F18",80:"F19",90:"F20"]
        let key = special[event.keyCode] ?? (event.charactersIgnoringModifiers ?? "").uppercased()
        guard !key.isEmpty, key.count == 1 && key.range(of: "^[A-Z0-9]$", options: .regularExpression) != nil || special[event.keyCode] != nil else { return }
        finish((parts + [key]).joined(separator: "+"))
    }
    func finish(_ key: String?) { recording = false; if let key = key { model?.setting("setShortcut", ["slot": slot, "accelerator": key]) }; model?.setting("suppressShortcuts", ["on": false]); title = key.map(prettyShortcut) ?? "录制快捷键" }
    override func resignFirstResponder() -> Bool { if recording { finish(nil) }; return super.resignFirstResponder() }
}
struct ComposerSettings: View {
    @ObservedObject var model: Model
    var body: some View { GroupBox { VStack(spacing: 0) {
        SettingLine(title: "点按外部关闭") { Toggle("点按外部关闭", isOn: Binding(get: { model.prefs["dismissOnOutside"] as? Bool ?? true }, set: { model.setting("setComposerPrefs", ["dismissOnOutside": $0]) })).labelsHidden().toggleStyle(.switch) }
    }.padding(4) } }
}
struct BotSettings: View {
    @ObservedObject var model: Model
    var botId: String? = nil
    @State private var prefix = ""
    var currentId: String { botId ?? model.settingsBot }
    var recipient: [String: Any] { model.recipients.first { ($0["botId"] as? String) == currentId } ?? [:] }
    var sources: [String: Bool] { recipient["sources"] as? [String: Bool] ?? [:] }
    func configure(_ patch: [String: Any]) { model.setting("configure", ["botId": currentId, "patch": patch]) }
    var body: some View {
        if model.bots.isEmpty { VStack(alignment: .leading, spacing: 8) { Text("没有 Bot").font(.headline); Text("连接账号后即可配置 Bot。").foregroundStyle(.secondary) }.padding(.vertical, 20) }
        else { GroupBox { VStack(spacing: 0) {
            SettingLine(title: "收到之后") { Picker("收到之后", selection: Binding(get: { recipient["mode"] as? String ?? "compose" }, set: { configure(["mode": $0]) })) { Text("输入框").tag("compose"); Text("直接发送").tag("direct") }.pickerStyle(.segmented).labelsHidden().frame(width: 180) }; Divider()
            if recipient["mode"] as? String == "direct" { SettingLine(title: "前缀") { TextField("加在正文前", text: $prefix).frame(width: 180).onSubmit { configure(["prefix": prefix]) } }; Divider() }
            DisclosureGroup("高级设置") { BotAdvancedSettings(model: model, botId: currentId).padding(.top, 8) }.padding(.vertical, 8)
        }.padding(4) }.onAppear { prefix = recipient["prefix"] as? String ?? "" }.onChange(of: currentId) { _ in prefix = recipient["prefix"] as? String ?? "" } }
    }
}
struct BotAdvancedSettings: View {
    @ObservedObject var model: Model
    let botId: String
    @State private var confirmCopy = false
    var rawBot: [String: Any] { (model.snapshot["bots"] as? [[String: Any]] ?? []).first { ($0["id"] as? String) == botId } ?? [:] }
    var memberIds: [String] { rawBot["memberAgentIds"] as? [String] ?? [] }
    var isGroup: Bool { (rawBot["kind"] as? String) == "GROK_BOT_AGENT_KIND_ROOM" || !memberIds.isEmpty }
    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let description = rawBot["description"] as? String, !description.isEmpty { Text("指令描述").font(.caption).foregroundStyle(.secondary); Text(description).font(.caption).textSelection(.enabled) }
            Text(isGroup ? "群聊" : "Bot").font(.caption).foregroundStyle(.secondary)
            if !memberIds.isEmpty { Text("成员：" + model.bots.filter { memberIds.contains($0.id) }.map(\.name).joined(separator: "、")).font(.caption) }
            Text("Bot ID").font(.caption).foregroundStyle(.secondary)
            Text(botId).font(.caption.monospaced()).textSelection(.enabled).lineLimit(2)
            HStack { if !isGroup { Button("复制 Bot") { confirmCopy = true } }; Button("在 Grok Bot 打开") { emit("open", ["botId": botId]) } }
            DisclosureGroup("此 Bot 的发送记录") { HistorySettings(model: model, botFilter: botId).padding(.top, 8) }
        }.frame(maxWidth: .infinity, alignment: .leading).confirmationDialog("复制此 Bot？", isPresented: $confirmCopy) { Button("复制") { model.setting("duplicateBot", ["botId": botId]) } }
    }
}
struct ShareSettings: View {
    @ObservedObject var model: Model
    var menu: [String: Any] { model.host["menu"] as? [String: Any] ?? [:] }
    var shareBots: [Bot] { model.bots.filter { bot in let recipient = model.recipients.first { ($0["botId"] as? String) == bot.id } ?? [:]; let sources = recipient["sources"] as? [String: Bool] ?? [:]; return recipient["enabled"] as? Bool == true && sources["wechat"] == true }.sorted { a, b in (model.recipients.first { ($0["botId"] as? String) == a.id }?["order"] as? Int ?? 0) < (model.recipients.first { ($0["botId"] as? String) == b.id }?["order"] as? Int ?? 0) }.prefix(12).map { $0 } }
    var body: some View { GroupBox { VStack(spacing: 0) {
        SettingLine(title: "微信转发", subtitle: (menu["available"] as? Bool ?? false) ? "同步当前启用的 Bot。" : "当前版本没有分享扩展。") { Button("重新同步") { model.setting("updateMenu") }.disabled(!(menu["available"] as? Bool ?? false)) }; Divider()
        SettingLine(title: "分享菜单顺序", subtitle: "按微信当前顺序重新排列。") { Button("读取顺序") { model.setting("readMenuOrder") }.disabled(!(menu["available"] as? Bool ?? false)) }; Divider()
        ForEach(shareBots, id: \.id) { bot in HStack { Text(bot.name); Spacer(); Button { model.setting("moveShare", ["botId": bot.id, "delta": -1]) } label: { Image(systemName: "chevron.up") }; Button { model.setting("moveShare", ["botId": bot.id, "delta": 1]) } label: { Image(systemName: "chevron.down") } }.padding(.vertical, 4) }
        Divider()
        SettingLine(title: "排查", subtitle: "复制分享菜单状态和最近的错误。") { Button("复制报错日志") { model.setting("copyDiagnostics") } }
    }.padding(4) } }
}
struct ToolboxSettings: View {
    @ObservedObject var model: Model
    @State private var showConfirm = false
    var cli: [String: Any] { model.host["cli"] as? [String: Any] ?? [:] }
    var body: some View { GroupBox { VStack(spacing: 0) {
        SettingLine(title: "关闭接收转发", subtitle: "关闭所有 Bot 的接收，保留来源和前缀设置。") { Button("一键关闭") { showConfirm = true } }; Divider()
        SettingLine(title: "命令行", subtitle: "登录信息会以明文保存在本机用户目录。") { Toggle("命令行", isOn: Binding(get: { cli["enabled"] as? Bool ?? false }, set: { model.setting("setCli", ["enabled": $0]) })).labelsHidden().toggleStyle(.switch) }
    }.padding(4) }.confirmationDialog("关闭所有 Bot 的接收转发？", isPresented: $showConfirm) { Button("关闭接收", role: .destructive) { model.setting("disableAllReceive") } } }
}
struct HistorySettings: View {
    @ObservedObject var model: Model
    var botFilter: String? = nil
    var records: [[String: Any]] { model.allRecords.filter { botFilter == nil || ($0["botId"] as? String) == botFilter } }
    var body: some View { VStack(spacing: 12) {
        if records.isEmpty { Text("还没有发送记录。").foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
        ForEach(Array(records.enumerated()), id: \.offset) { _, item in
            GroupBox { VStack(alignment: .leading, spacing: 8) {
                HStack { Text(item["botName"] as? String ?? "Bot").font(.headline); Spacer(); Text(item["status"] as? String ?? "").font(.caption).foregroundStyle(.secondary) }
                if let text = item["text"] as? String, !text.isEmpty { Text(text).textSelection(.enabled) }
                ForEach(Array((item["files"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, file in Text(file["name"] as? String ?? "附件").font(.caption).foregroundStyle(.secondary) }
                ForEach(Array((item["replies"] as? [[String: Any]] ?? []).enumerated()), id: \.offset) { _, reply in if let text = reply["text"] as? String { Text(text).textSelection(.enabled).padding(8).frame(maxWidth: .infinity, alignment: .leading).background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8)) } }
                if let id = item["id"] as? String { HStack { if item["status"] as? String == "needs-input" { Button("打开输入框") { model.setting("prepareReceipt", ["id": id]) } }; if item["status"] as? String == "failed" { Button("重试") { model.setting("retry", ["id": id]) } }; if item["status"] as? String == "unconfirmed" && !(item["holdResolved"] as? Bool ?? false) { Button("已核对，恢复发送") { model.setting("resolve", ["id": id]) } } } }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(4) }
        }
    } }
}
