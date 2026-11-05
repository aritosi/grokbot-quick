import AppKit
import SwiftUI
import Foundation
import UniformTypeIdentifiers

func emit(_ action: String, _ extra: [String: Any] = [:]) {
    var value = extra; value["action"] = action
    guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value), let line = String(data: data, encoding: .utf8) else { return }
    print(line); fflush(stdout)
}
struct Bot: Identifiable { let id: String; let name: String; let summary: String }
struct Message: Identifiable { let id: String; let text: String; let outgoing: Bool; let status: String; let files: [String] }
struct StagedItem: Codable, Identifiable {
    var id: String
    var text: String
    var files: [String]
}

// The staging area owns its copies; the original files are never modified.
final class StagingStore {
    let directory: URL
    let index: URL
    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1", let override = ProcessInfo.processInfo.environment["GROK_STAGING_TEST_DIR"], !override.isEmpty {
            directory = URL(fileURLWithPath: override, isDirectory: true)
        } else if let override = ProcessInfo.processInfo.environment["GROK_STAGING_DIR"], !override.isEmpty {
            directory = URL(fileURLWithPath: override, isDirectory: true)
        } else { directory = base.appendingPathComponent("GrroBot Quick/Staging", isDirectory: true) }
        index = directory.appendingPathComponent("items.json")
    }
    func load() -> [StagedItem] {
        guard let data = try? Data(contentsOf: index), let items = try? JSONDecoder().decode([StagedItem].self, from: data) else { return [] }
        return items
    }
    func save(_ items: [StagedItem]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let data = try JSONEncoder().encode(items)
        try data.write(to: index, options: [.atomic, .completeFileProtectionUnlessOpen])
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: index.path)
    }
    func copy(_ urls: [URL], id: String) throws -> [String] {
        let folder = directory.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        var paths: [String] = []
        do {
            for (i, url) in urls.enumerated() {
                let info = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                guard url.isFileURL, info.isRegularFile == true, (info.fileSize ?? 0) > 0 else { throw CocoaError(.fileReadUnsupportedScheme) }
                let subfolder = folder.appendingPathComponent(String(i), isDirectory: true)
                try FileManager.default.createDirectory(at: subfolder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                let target = subfolder.appendingPathComponent(url.lastPathComponent)
                try FileManager.default.copyItem(at: url, to: target)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: target.path)
                paths.append(target.path)
            }
            return paths
        } catch { try? FileManager.default.removeItem(at: folder); throw error }
    }
    func removeFiles(id: String) {
        guard UUID(uuidString: id) != nil else { return }
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(id, isDirectory: true))
    }
}
final class Model: ObservableObject {
    private let stagingStore = StagingStore()
    @Published var staged: [StagedItem] = []
    @Published var stagingDraft = ""
    @Published var stagingError = ""
    @Published var screenshotItem: StagedItem?
    @Published var quickBusy = false
    @Published var quickMessage = ""
    var quickSource = ""
    var quickText = ""
    @Published var floatingBotId = ""
    @Published var floatingPrompt = ""
    @Published var floatingStatus = ""
    @Published var floatingOpacity: Double = 0.88
    @Published var floatingExpanded = true
    @Published var floatingVisible = false
    @Published var barText = ""
    @Published var barBotId = ""
    var onBar: (() -> Void)?
    var onCapture: (() -> Void)?
    var onFloating: (() -> Void)?
    var onFloatingLayout: (() -> Void)?
    var onFloatingMove: ((CGSize, Bool) -> Void)?
    func quickSend(botId: String, text: String, files: [String], source: String = "other") {
        guard !quickBusy, !botId.isEmpty, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { quickMessage = "请先选择 Bot 并填写提示词。"; return }
        quickBusy = true; quickSource = source; quickText = text; quickMessage = "正在加入发送流程…"; emit("quickSend", ["botId": botId, "text": text, "files": files])
    }
    func saveFloating() {
        guard ProcessInfo.processInfo.environment["GROK_STAGING_DIR"] == nil, ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] != "1" else { return }
        UserDefaults.standard.set(floatingBotId, forKey: "floatingBotId"); UserDefaults.standard.set(floatingPrompt, forKey: "floatingPrompt"); UserDefaults.standard.set(floatingOpacity, forKey: "floatingOpacity")
    }
    @Published var taskMessage = ""
    @Published var taskCreating = false
    @Published var taskDraftItem: StagedItem?
    func task(_ method: String, _ params: [String: Any]) { if method == "taskCreate" { guard !taskCreating else { return }; taskCreating = true }; taskMessage = ""; emit("taskAction", ["method": method, "params": params]) }
    var onStagingFiles: (() -> Void)?
    init() {
        staged = stagingStore.load()
        if ProcessInfo.processInfo.environment["GROK_STAGING_DIR"] == nil, ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] != "1" {
            floatingBotId = UserDefaults.standard.string(forKey: "floatingBotId") ?? ""
            floatingPrompt = UserDefaults.standard.string(forKey: "floatingPrompt") ?? ""
            let opacity = UserDefaults.standard.double(forKey: "floatingOpacity"); if opacity >= 0.35 && opacity <= 1 { floatingOpacity = opacity }
        }
    }
    func stage(text: String, files: [URL] = []) {
        let clean = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty || !files.isEmpty else { return }
        let id = UUID().uuidString
        do {
            let paths = try stagingStore.copy(files, id: id)
            let next = staged + [StagedItem(id: id, text: clean, files: paths)]
            do { try stagingStore.save(next) } catch { stagingStore.removeFiles(id: id); throw error }
            staged = next; stagingDraft = ""; stagingError = ""
        } catch { stagingError = "暂存失败，请检查文件是否可读取及磁盘空间。" }
    }
    func changeStaged(_ next: [StagedItem]) {
        do { try stagingStore.save(next); staged = next; stagingError = "" }
        catch { stagingError = "保存失败，请检查磁盘空间。" }
    }
    func removeStaged(_ id: String) {
        if let item = staged.first(where: { $0.id == id }) {
            let used = Set(attachments.map(\.path) + attachmentDrafts.values.flatMap { $0.map(\.path) })
            guard used.isDisjoint(with: item.files) else { stagingError = "该暂存项仍在聊天草稿中，请先移除附件或发送。"; return }
        }
        let next = staged.filter { $0.id != id }
        do { try stagingStore.save(next); staged = next; stagingStore.removeFiles(id: id); stagingError = "" }
        catch { stagingError = "删除失败，请检查磁盘空间。" }
    }
    func insertStaged(_ item: StagedItem) {
        guard bot != nil else { stagingError = "请先打开一个 Bot 的聊天。"; return }
        if !item.text.isEmpty { draft += (draft.isEmpty ? "" : "\n") + item.text }
        addAttachments(item.files.map { URL(fileURLWithPath: $0) })
        mode = "chat"; onOpenChat?()
    }
    @Published var avatarImages: [String: NSImage] = [:]
    @Published var snapshot: [String: Any] = [:]
    @Published var settingsSection = "general"
    @Published var settingsBot = ""
    @Published var settingsMessage = ""
    @Published var bots: [Bot] = []
    @Published var messages: [Message] = []
    @Published var mode = "list"
    @Published var wheelGeneration = 0
    @Published var selected = ""
    @Published var draft = ""
    @Published var sending = false
    @Published var error = ""
    @Published var expanded = false
    @Published var pinned = false
    @Published var showBotSettings = false
    @Published var pickingFiles = false
    @Published var attachments: [URL] = []
    @Published var receiptId = ""
    @Published var remoteFiles: [String] = []
    @Published var page = 0
    var drafts: [String: String] = [:]
    var attachmentDrafts: [String: [URL]] = [:]
    var pendingFiles: [String] = []
    var pendingReceiptId = ""
    var receiptDrafts: [String: (String, [String])] = [:]
    var onChooseFiles: (() -> Void)?
    var onOpenChat: (() -> Void)?
    var onBackToList: (() -> Void)?
    var allRecords: [[String: Any]] = []
    var pendingBot = "", pendingText = ""
    var bot: Bot? { bots.first { $0.id == selected } }
    func lastMessage(for bot: Bot) -> String {
        guard let item = allRecords.first(where: { ($0["botId"] as? String) == bot.id }) else { return bot.summary }
        let replies = item["replies"] as? [[String: Any]] ?? []
        return (replies.last?["text"] as? String) ?? (item["text"] as? String) ?? bot.summary
    }
    func wheelBot(_ ring: String, _ index: Int) -> Bot? {
        let layout = snapshot["wheelLayout"] as? [String: [String]] ?? [:]
        let saved = layout[ring]
        let fallback = ring == "inner" ? index : index + 6
        let id = saved != nil && saved!.indices.contains(index) ? saved![index] : (bots.indices.contains(fallback) ? bots[fallback].id : "")
        return bots.first { $0.id == id }
    }
    func addAttachments(_ urls: [URL]) {
        var existing = Set(attachments.map(\.path))
        for url in urls where attachments.count < 100 {
            let file = url.standardizedFileURL
            guard file.isFileURL, let info = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]), info.isRegularFile == true, (info.fileSize ?? 0) > 0 else { error = "请添加非空文件或图片。"; continue }
            guard existing.insert(file.path).inserted else { continue }
            attachments.append(file)
        }
        if !selected.isEmpty { attachmentDrafts[selected] = attachments }
    }
    func select(_ bot: Bot) {
        let keepSidebar = pinned && showBotSettings
        if !selected.isEmpty { drafts[selected] = draft; attachmentDrafts[selected] = attachments; receiptDrafts[selected] = (receiptId, remoteFiles) }
        selected = bot.id; settingsBot = bot.id; draft = drafts[bot.id] ?? ""; attachments = attachmentDrafts[bot.id] ?? []; receiptId = receiptDrafts[bot.id]?.0 ?? ""; remoteFiles = receiptDrafts[bot.id]?.1 ?? []; mode = "chat"; showBotSettings = keepSidebar; error = ""; rebuildMessages()
        emit("selected", ["botId": bot.id]); onOpenChat?()
    }
    func setAvatars(_ images: [String: String]) {
        var result: [String: NSImage] = [:]
        for (id, raw) in images {
            guard let comma = raw.firstIndex(of: ","), raw.hasPrefix("data:image/png;base64,"), let data = Data(base64Encoded: String(raw[raw.index(after: comma)...])), let image = NSImage(data: data) else { continue }
            result[id] = image
        }
        avatarImages = result
    }
    func setAvatar(id: String, raw: String) {
        guard !id.isEmpty, raw.hasPrefix("data:image/png;base64,"), let comma = raw.firstIndex(of: ","), let data = Data(base64Encoded: String(raw[raw.index(after: comma)...])), let image = NSImage(data: data) else { return }
        avatarImages[id] = image
    }
    var onResize: ((Bool) -> Void)?
    func update(_ value: [String: Any]) {
        snapshot = value
        switch value["theme"] as? String { case "light": NSApp.appearance = NSAppearance(named: .aqua); case "dark": NSApp.appearance = NSAppearance(named: .darkAqua); default: NSApp.appearance = nil }
        bots = (value["bots"] as? [[String: Any]] ?? []).compactMap { row in
            guard let id = row["id"] as? String, let name = row["name"] as? String, !name.isEmpty else { return nil }; return Bot(id: id, name: name, summary: (row["description"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
        }
        if settingsBot.isEmpty || !bots.contains(where: { $0.id == settingsBot }) { settingsBot = bots.first?.id ?? "" }
        page = min(page, max(0, (bots.count - 1) / 6))
        allRecords = value["inbox"] as? [[String: Any]] ?? []
        rebuildMessages()
    }
    func rebuildMessages() {
        var result: [Message] = [], seen = Set<String>()
        for item in allRecords.reversed() where (item["botId"] as? String) == selected && (item["status"] as? String) != "needs-input" {
            let id = item["id"] as? String ?? UUID().uuidString
            let text = item["text"] as? String ?? "", files = (item["files"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
            if !text.isEmpty || !files.isEmpty { result.append(Message(id: id, text: text, outgoing: true, status: item["status"] as? String ?? "", files: files)) }
            for reply in item["replies"] as? [[String: Any]] ?? [] {
                let rid = reply["id"] as? String ?? UUID().uuidString
                guard !seen.contains(rid), let text = reply["text"] as? String else { continue }; seen.insert(rid)
                result.append(Message(id: rid, text: text, outgoing: false, status: "", files: []))
            }
        }
        messages = result
    }
    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (!text.isEmpty || !attachments.isEmpty || !remoteFiles.isEmpty) && !sending && !selected.isEmpty else { return }
        sending = true; pendingBot = selected; pendingText = text; pendingFiles = attachments.map(\.path); pendingReceiptId = receiptId; error = ""; emit("send", ["botId": selected, "text": text, "files": pendingFiles, "receiptId": receiptId])
    }
    func result(_ value: [String: Any]) {
        sending = false
        if value["ok"] as? Bool == true {
            if selected == pendingBot && draft.trimmingCharacters(in: .whitespacesAndNewlines) == pendingText { draft = "" }
            if drafts[pendingBot]?.trimmingCharacters(in: .whitespacesAndNewlines) == pendingText { drafts[pendingBot] = "" }
            if selected == pendingBot { attachments.removeAll { pendingFiles.contains($0.path) }; attachmentDrafts[selected] = attachments }
            else { attachmentDrafts[pendingBot]?.removeAll { pendingFiles.contains($0.path) } }
            if !pendingReceiptId.isEmpty { if selected == pendingBot && receiptId == pendingReceiptId { receiptId = ""; remoteFiles = [] }; if receiptDrafts[pendingBot]?.0 == pendingReceiptId { receiptDrafts[pendingBot] = ("", []) } }
        } else { error = value["message"] as? String ?? "发送未完成，请检查连接。" }
        pendingBot = ""; pendingText = ""; pendingFiles = []; pendingReceiptId = ""
    }
}
struct PanelView: View {
    @ObservedObject var model: Model
    @ViewBuilder var content: some View {
        if model.mode == "wheel" { WheelView(model: model).id(model.wheelGeneration) }
        else if model.mode == "chat", let bot = model.bot { ChatView(model: model, bot: bot) }
        else if model.mode == "staging" { StagingView(model: model) }
        else if model.mode == "tasks" { TaskQueueView(model: model) }
        else if model.mode == "task-create" { TaskCreateView(model: model) }
        else if model.mode == "screenshot" { ScreenshotAskView(model: model) }
        else { BotList(model: model) }
    }
    var body: some View {
        Group {
            if model.mode == "wheel" { content }
            else { content.frame(maxWidth: .infinity, maxHeight: .infinity).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous)).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous)) }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
struct BotAvatar: View {
    @ObservedObject var model: Model
    let bot: Bot
    var size: CGFloat = 42
    var body: some View {
        Group {
            if let image = model.avatarImages[bot.id] { Image(nsImage: image).resizable().interpolation(.high).aspectRatio(contentMode: .fit) }
            else { Text(String(bot.name.prefix(1))).font(.system(size: size * 0.36, weight: .medium)).foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity) }
        }.frame(width: size, height: size).background(.quaternary.opacity(0.18), in: RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)).clipShape(RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)).accessibilityHidden(true)
    }
}
struct ListBotRow: View {
    @ObservedObject var model: Model
    let bot: Bot
    @State private var hovering = false
    var body: some View {
        Button { model.select(bot) } label: {
            HStack(spacing: 12) {
                BotAvatar(model: model, bot: bot, size: 42)
                VStack(alignment: .leading, spacing: 4) {
                    Text(bot.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                    let preview = model.lastMessage(for: bot)
                    if !preview.isEmpty { Text(preview).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(2) }
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(.tertiary).opacity(hovering ? 1 : 0.55)
            }.padding(.horizontal, 10).padding(.vertical, 7).contentShape(Rectangle())
                .background(hovering ? Color.primary.opacity(0.055) : Color.clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }.buttonStyle(.plain).onHover { inside in withAnimation(.easeOut(duration: 0.16)) { hovering = inside } }.accessibilityLabel("与\(bot.name)对话")
    }
}
struct BotList: View {
    @ObservedObject var model: Model
    @State private var search = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) { Text("对话").font(.system(size: 23, weight: .bold)) }
                Spacer()
                Button { emit("settings") } label: { Image(systemName: "gearshape").font(.system(size: 14, weight: .medium)).frame(width: 30, height: 30).background(.primary.opacity(0.055), in: Circle()) }.buttonStyle(.plain).help("设置")
            }.padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 14)
            if !model.quickMessage.isEmpty { Text(model.quickMessage).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 16) }
            TextField("搜索", text: $search).textFieldStyle(.roundedBorder).padding(.horizontal, 16).padding(.bottom, 10)
            if model.bots.isEmpty { Spacer(); VStack(spacing: 7) { Image(systemName: "person.crop.circle.badge.questionmark").font(.system(size: 23)); Text("连接账号后显示 Bot").font(.callout) }.foregroundStyle(.secondary).frame(maxWidth: .infinity); Spacer() }
            else { ScrollView { LazyVStack(spacing: 2) { ForEach(model.bots.filter { search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) }) { bot in ListBotRow(model: model, bot: bot); Divider().padding(.leading, 64) } }.padding(.horizontal, 8).padding(.bottom, 6) } }
            Rectangle().fill(.primary.opacity(0.08)).frame(height: 0.5).padding(.horizontal, 16)
            HStack(spacing: 8) {
                Button { emit("wheel") } label: { Label("快捷轮盘", systemImage: "circle.grid.cross").font(.system(size: 11, weight: .medium)) }.buttonStyle(.borderless)
                Button { model.onCapture?() } label: { Image(systemName: "viewfinder") }.buttonStyle(.borderless).help("截图即问")
                Button { model.mode = "staging" } label: { Label("中转台", systemImage: "tray").font(.system(size: 11, weight: .medium)) }.buttonStyle(.borderless)
                Spacer(); Button("退出") { emit("quit") }.buttonStyle(.borderless).font(.system(size: 11)).foregroundStyle(.secondary)
            }.padding(.horizontal, 18).padding(.vertical, 13)
        }.frame(minWidth: 300, minHeight: 380)
    }
}
struct WindowDragArea: NSViewRepresentable {
    func makeNSView(context: Context) -> DragHandle { DragHandle() }
    func updateNSView(_ view: DragHandle, context: Context) {}
}
final class DragHandle: NSView {
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
}
struct ChatWindowView: View {
    @ObservedObject var model: Model
    var body: some View { Group { if let bot = model.bot { ChatView(model: model, bot: bot) } else { EmptyView() } }.frame(maxWidth: .infinity, maxHeight: .infinity).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 19, style: .continuous)).clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous)) }
}
struct ChatView: View {
    @ObservedObject var model: Model
    let bot: Bot
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var inputFocused: Bool
    @State private var dropTarget = false
    var body: some View {
        HStack(spacing: 0) {
            conversation.frame(minWidth: 350, maxWidth: .infinity)
            if model.showBotSettings { Divider(); ChatBotSidebar(model: model).frame(width: 300) }
        }.background(colorScheme == .dark ? Color.black.opacity(0.24) : Color.white.opacity(0.28))
            .frame(minWidth: model.showBotSettings ? 650 : 350, minHeight: 430).onAppear { inputFocused = true }
    }
    var conversation: some View {
        VStack(spacing: 0) {
            ZStack {
                VStack(spacing: 2) { BotAvatar(model: model, bot: bot, size: 31); Text(bot.name).font(.system(size: 12, weight: .semibold)).lineLimit(1) }.frame(maxWidth: 150).overlay(WindowDragArea()).help("拖动聊天窗口")
                HStack(spacing: 8) {
                    Button { model.drafts[model.selected] = model.draft; model.attachmentDrafts[model.selected] = model.attachments; model.showBotSettings = false; model.pinned = false; model.onBackToList?() } label: { Image(systemName: "chevron.left").font(.system(size: 15, weight: .medium)) }.help("返回 Bot 列表")
                    Spacer(minLength: 0)
                    Button { model.pinned.toggle() } label: { Image(systemName: model.pinned ? "pin.fill" : "pin").foregroundStyle(model.pinned ? Color.accentColor : Color.secondary) }.help(model.pinned ? "取消固定" : "固定聊天")
                    Button { model.expanded.toggle(); model.onResize?(model.expanded) } label: { Image(systemName: model.expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") }.help("展开或收起")
                    Button { model.showBotSettings.toggle(); model.settingsBot = bot.id; model.onResize?(model.expanded) } label: { Image(systemName: "gearshape.fill").foregroundStyle(model.showBotSettings ? Color.accentColor : Color.secondary) }.help("Bot 设置")
                }.buttonStyle(.borderless).foregroundStyle(Color.accentColor)
            }.padding(.horizontal, 14).padding(.vertical, 9)
            Divider()
            ScrollViewReader { proxy in
                ScrollView { LazyVStack(alignment: .leading, spacing: 5) {
                    if model.messages.isEmpty { Text("开始与 \(bot.name) 对话").font(.system(size: 11)).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.top, 20) }
                    ForEach(model.messages) { message in
                        VStack(alignment: message.outgoing ? .trailing : .leading, spacing: 3) {
                            HStack { if message.outgoing { Spacer(minLength: 38) }
                                VStack(alignment: .leading, spacing: 6) {
                                    if !message.text.isEmpty { Text(message.text).textSelection(.enabled) }
                                    ForEach(message.files, id: \.self) { name in Label(name, systemImage: "doc").font(.system(size: 11)).lineLimit(1) }
                                }.font(.system(size: 13)).padding(.horizontal, 12).padding(.vertical, 8)
                                    .foregroundStyle(message.outgoing ? Color.white : Color.primary)
                                    .background(message.outgoing ? Color(red: 0.02, green: 0.47, blue: 0.96) : (colorScheme == .dark ? Color(white: 0.16) : Color(white: 0.91)), in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                                if !message.outgoing { Spacer(minLength: 38) }
                            }
                            if message.status == "failed" || message.status == "unconfirmed" { Text(message.status == "failed" ? "发送失败，请查看发送记录" : "结果未确认，请查看发送记录").font(.caption2).foregroundStyle(.red) }
                        }.id(message.id)
                    }
                }.padding(.horizontal, 12).padding(.vertical, 14) }.onChange(of: model.messages.count) { _ in if let last = model.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } } }
            }
            if !model.error.isEmpty { Text(model.error).font(.caption).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 14) }
            if !model.attachments.isEmpty || !model.remoteFiles.isEmpty { ScrollView(.horizontal, showsIndicators: false) { HStack(spacing: 6) { ForEach(Array(model.remoteFiles.enumerated()), id: \.offset) { _, name in Label(name, systemImage: "doc").font(.system(size: 10)).lineLimit(1).padding(6).background(Color.secondary.opacity(0.12), in: Capsule()) }; ForEach(model.attachments, id: \.self) { url in HStack(spacing: 4) { Image(systemName: "doc"); Text(url.lastPathComponent).lineLimit(1).frame(maxWidth: 110); Button { model.attachments.removeAll { $0 == url }; model.attachmentDrafts[model.selected] = model.attachments } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain) }.font(.system(size: 10)).padding(6).background(Color.secondary.opacity(0.12), in: Capsule()) } }.padding(.horizontal, 12) }.padding(.bottom, 4) }
            Divider()
            HStack(alignment: .bottom, spacing: 7) {
                Button { model.mode = "staging"; emit("staging") } label: { Image(systemName: "tray").font(.system(size: 14)).frame(width: 26, height: 28) }.buttonStyle(.plain).help("从中转台添加")
                Button { model.onChooseFiles?() } label: { Image(systemName: "plus").font(.system(size: 15, weight: .medium)).frame(width: 28, height: 28).background(Color.secondary.opacity(0.14), in: Circle()) }.buttonStyle(.plain).help("选择文件或图片")
                TextField("信息", text: $model.draft, axis: .vertical).lineLimit(1...5).textFieldStyle(.plain).padding(.horizontal, 11).padding(.vertical, 6).background(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.secondary.opacity(0.35))).focused($inputFocused).onSubmit { model.send() }
                Button { model.send() } label: { Image(systemName: "arrow.up.circle.fill").font(.system(size: 28)) }.buttonStyle(.plain).foregroundStyle(Color.accentColor).disabled(model.sending || (model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && model.attachments.isEmpty && model.remoteFiles.isEmpty)).help("发送")
            }.padding(.horizontal, 12).padding(.vertical, 10)
        }.overlay { if dropTarget { RoundedRectangle(cornerRadius: 15).strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6])).padding(5).allowsHitTesting(false) } }
            .onDrop(of: [UTType.fileURL.identifier], isTargeted: $dropTarget) { providers in
                let items = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
                for item in items { item.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { value, _ in
                    let url: URL? = (value as? URL) ?? (value as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) } ?? (value as? String).flatMap { URL(string: $0) }
                    if let url = url { DispatchQueue.main.async { model.addAttachments([url]) } }
                } }
                return !items.isEmpty
            }
    }
}
struct StagingView: View {
    @ObservedObject var model: Model
    @State private var dropTarget = false
    @State private var editing: String? = nil
    @State private var editedText = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button { model.mode = "list" } label: { Image(systemName: "chevron.left") }.buttonStyle(.plain).help("返回")
                Text("中转台").font(.system(size: 21, weight: .bold)); Spacer()
                Button("任务队列") { model.mode = "tasks" }.buttonStyle(.borderless).font(.caption)
                Button { model.onStagingFiles?() } label: { Image(systemName: "plus") }.buttonStyle(.borderless).help("添加文件")
            }.padding(18)
            HStack(alignment: .bottom) {
                TextField("暂存文字或想法", text: $model.stagingDraft, axis: .vertical).lineLimit(1...4).textFieldStyle(.roundedBorder)
                Button("添加") { model.stage(text: model.stagingDraft) }.disabled(model.stagingDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.padding(.horizontal, 16).padding(.bottom, 10)
            if !model.stagingError.isEmpty { Text(model.stagingError).font(.caption).foregroundStyle(.red).padding(.horizontal, 16) }
            if model.staged.isEmpty { Spacer(); Text("拖入文件，或在上方添加文字").foregroundStyle(.secondary).font(.callout).frame(maxWidth: .infinity); Spacer() }
            else { ScrollView { LazyVStack(spacing: 8) {
                ForEach(Array(model.staged.enumerated()), id: \.element.id) { index, item in
                    VStack(alignment: .leading, spacing: 8) {
                        if editing == item.id {
                            TextField("文字", text: $editedText, axis: .vertical).lineLimit(1...5).textFieldStyle(.roundedBorder)
                            HStack { Button("保存") { var next = model.staged; if let i = next.firstIndex(where: { $0.id == item.id }) { next[i].text = editedText; model.changeStaged(next) }; editing = nil }; Button("取消") { editing = nil } }
                        } else if !item.text.isEmpty { Text(item.text).font(.system(size: 12)).lineLimit(4).textSelection(.enabled) }
                        ForEach(item.files, id: \.self) { path in Label(URL(fileURLWithPath: path).lastPathComponent, systemImage: "doc").font(.caption).lineLimit(1) }
                        HStack(spacing: 10) {
                            Button("添加到聊天") { model.insertStaged(item) }.disabled(model.bot == nil)
                            Button("编辑") { editedText = item.text; editing = item.id }
                            Button("排队") { model.taskDraftItem = item; model.mode = "task-create" }
                            Spacer()
                            Button { var next = model.staged; guard index > 0 else { return }; next.swapAt(index, index - 1); model.changeStaged(next) } label: { Image(systemName: "arrow.up") }.disabled(index == 0).help("上移")
                            Button { var next = model.staged; guard index + 1 < next.count else { return }; next.swapAt(index, index + 1); model.changeStaged(next) } label: { Image(systemName: "arrow.down") }.disabled(index + 1 >= model.staged.count).help("下移")
                            Button { model.removeStaged(item.id) } label: { Image(systemName: "trash") }.help("删除暂存项")
                        }.buttonStyle(.borderless).font(.caption)
                    }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                }
            }.padding(.horizontal, 16).padding(.bottom, 16) } }
        }.frame(minWidth: 300, minHeight: 380)
            .overlay { if dropTarget { RoundedRectangle(cornerRadius: 15).strokeBorder(Color.accentColor, style: StrokeStyle(lineWidth: 2, dash: [6])).padding(5).allowsHitTesting(false) } }
            .onDrop(of: [UTType.fileURL.identifier], isTargeted: $dropTarget) { providers in
                let items = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
                for item in items { item.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { value, _ in
                    let url: URL? = (value as? URL) ?? (value as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) } ?? (value as? String).flatMap { URL(string: $0) }
                    if let url = url { DispatchQueue.main.async { model.stage(text: "", files: [url]) } }
                } }
                return !items.isEmpty
            }
    }
}
struct TaskCreateView: View {
    @ObservedObject var model: Model
    @State private var botId = ""
    @State private var text = ""
    @State private var timed = false
    @State private var date = Date().addingTimeInterval(600)
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack { Button { model.mode = "staging" } label: { Image(systemName: "chevron.left") }.buttonStyle(.plain); Text("加入任务队列").font(.headline); Spacer() }
            Picker("目标 Bot", selection: $botId) { Text("选择 Bot").tag(""); ForEach(model.bots) { bot in Text(bot.name).tag(bot.id) } }
            TextField("任务内容", text: $text, axis: .vertical).lineLimit(3...7).textFieldStyle(.roundedBorder)
            if let item = model.taskDraftItem, !item.files.isEmpty { Text("\(item.files.count) 个附件将复制到任务中").font(.caption).foregroundStyle(.secondary) }
            Toggle("定时派发", isOn: $timed)
            if timed { DatePicker("派发时间", selection: $date, in: Date()..., displayedComponents: [.date, .hourAndMinute]); Text("应用需运行且账号在线；错过时间后需手动处理。").font(.caption).foregroundStyle(.secondary) }
            if !model.taskMessage.isEmpty { Text(model.taskMessage).font(.caption).foregroundStyle(.red) }
            Spacer()
            Button("加入队列") {
                guard let item = model.taskDraftItem else { return }
                model.task("taskCreate", ["botId": botId, "text": text, "files": item.files, "dueAt": timed ? Int64(date.timeIntervalSince1970 * 1000) : NSNull()])
            }.disabled(model.taskCreating || botId.isEmpty || (text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && (model.taskDraftItem?.files.isEmpty ?? true)))
        }.padding(18).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .onAppear { text = model.taskDraftItem?.text ?? ""; botId = model.selected.isEmpty ? (model.bots.first?.id ?? "") : model.selected; model.taskMessage = "" }
    }
}
struct TaskQueueView: View {
    @ObservedObject var model: Model
    @State private var editingId = ""
    @State private var editedText = ""
    @State private var editedTimed = false
    @State private var editedDate = Date().addingTimeInterval(600)
    var tasks: [[String: Any]] {
        model.allRecords.filter { $0["queue"] is [String: Any] }.sorted {
            let a = $0["queue"] as? [String: Any] ?? [:], b = $1["queue"] as? [String: Any] ?? [:]
            return (a["order"] as? Int ?? 0) < (b["order"] as? Int ?? 0)
        }
    }
    func stateName(_ state: String) -> String {
        switch state { case "queued": return "等待中"; case "missed": return "已错过"; case "running": return "派发中"; case "sent": return "已发送"; case "failed": return "失败"; case "unconfirmed": return "结果未确认"; case "cancelled": return "已取消"; default: return state }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack { Button { model.mode = "staging" } label: { Image(systemName: "chevron.left") }.buttonStyle(.plain); Text("任务队列").font(.system(size: 21, weight: .bold)); Spacer() }.padding(18)
            if !model.taskMessage.isEmpty { Text(model.taskMessage).font(.caption).foregroundStyle(.secondary).padding(.horizontal, 16) }
            if tasks.isEmpty { Spacer(); Text("从中转台选择素材加入队列").foregroundStyle(.secondary).font(.callout).frame(maxWidth: .infinity); Spacer() }
            else { ScrollView { LazyVStack(spacing: 8) {
                ForEach(Array(tasks.enumerated()), id: \.offset) { _, item in
                    let id = item["id"] as? String ?? "", q = item["queue"] as? [String: Any] ?? [:], state = q["state"] as? String ?? ""
                    let editable = state == "queued" || state == "missed"
                    VStack(alignment: .leading, spacing: 7) {
                        HStack { Text(item["botName"] as? String ?? "Bot").font(.caption.weight(.semibold)); Spacer(); Text(stateName(state)).font(.caption).foregroundStyle(.secondary) }
                        if editingId == id { TextField("任务内容", text: $editedText, axis: .vertical).lineLimit(1...5).textFieldStyle(.roundedBorder); Toggle("定时派发", isOn: $editedTimed); if editedTimed { DatePicker("派发时间", selection: $editedDate, in: Date()..., displayedComponents: [.date, .hourAndMinute]) }; HStack { Button("保存") { model.task("taskUpdate", ["id": id, "text": editedText, "dueAt": editedTimed ? Int64(editedDate.timeIntervalSince1970 * 1000) : NSNull()]); editingId = "" }; Button("取消") { editingId = "" } } }
                        else { Text(item["text"] as? String ?? "").font(.system(size: 12)).lineLimit(4) }
                        if let files = item["files"] as? [[String: Any]], !files.isEmpty { Text("\(files.count) 个附件").font(.caption).foregroundStyle(.secondary) }
                        if let due = q["dueAt"] as? NSNumber { Text(Date(timeIntervalSince1970: due.doubleValue / 1000), style: .date).font(.caption).foregroundStyle(.secondary); Text(Date(timeIntervalSince1970: due.doubleValue / 1000), style: .time).font(.caption).foregroundStyle(.secondary) }
                        if editable { HStack(spacing: 9) {
                            Button("立即派发") { model.task("taskDispatch", ["id": id]) }
                            Button("编辑") { editedText = item["text"] as? String ?? ""; if let due = q["dueAt"] as? NSNumber, due.doubleValue / 1000 > Date().timeIntervalSince1970 { editedTimed = true; editedDate = Date(timeIntervalSince1970: due.doubleValue / 1000) } else { editedTimed = false; editedDate = Date().addingTimeInterval(600) }; editingId = id }
                            Button("取消任务") { model.task("taskCancel", ["id": id]) }
                            Spacer()
                            Button { model.task("taskMove", ["id": id, "direction": -1]) } label: { Image(systemName: "arrow.up") }.help("上移")
                            Button { model.task("taskMove", ["id": id, "direction": 1]) } label: { Image(systemName: "arrow.down") }.help("下移")
                        }.buttonStyle(.borderless).font(.caption) }
                    }.padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                }
            }.padding(16) } }
        }.frame(minWidth: 300, minHeight: 380)
    }
}
struct ScreenshotAskView: View {
    @ObservedObject var model: Model
    @State private var botId = ""
    @State private var question = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Button { model.mode = "list" } label: { Image(systemName: "chevron.left") }.buttonStyle(.plain); Text("截图即问").font(.headline); Spacer() }
            if let path = model.screenshotItem?.files.first, let image = NSImage(contentsOfFile: path) { Image(nsImage: image).resizable().scaledToFit().frame(maxWidth: .infinity, maxHeight: 230).clipShape(RoundedRectangle(cornerRadius: 10)) }
            Picker("目标 Bot", selection: $botId) { Text("选择 Bot").tag(""); ForEach(model.bots) { bot in Text(bot.name).tag(bot.id) } }
            TextField("关于这张截图，你想问什么？", text: $question, axis: .vertical).lineLimit(2...5).textFieldStyle(.roundedBorder)
            if !model.quickMessage.isEmpty { Text(model.quickMessage).font(.caption).foregroundStyle(.secondary) }
            Spacer()
            HStack { Text("截图已保存在中转台").font(.caption).foregroundStyle(.secondary); Spacer(); Button("发送") { if let item = model.screenshotItem { model.quickSend(botId: botId, text: question, files: item.files) } }.disabled(model.quickBusy || botId.isEmpty || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
        }.padding(18).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .onAppear { botId = model.selected.isEmpty ? (model.bots.first?.id ?? "") : model.selected; model.quickMessage = "" }
    }
}
struct FloatingBotView: View {
    @ObservedObject var model: Model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dropTarget = false
    @State private var dropLoading = false
    var current: Bot? { model.bots.first { $0.id == model.floatingBotId } }
    var busy: Bool { dropLoading || model.quickBusy }
    var body: some View {
        VStack(spacing: model.floatingExpanded ? 12 : 0) {
            HStack(spacing: model.floatingExpanded ? 10 : 4) {
                avatar
                if model.floatingExpanded {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(current?.name ?? "选择 Bot").font(.system(size: 13, weight: .semibold)).lineLimit(1)
                        Text(dropTarget ? "松开以处理文件" : busy ? "正在接收文件" : "点击头像打开对话").font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                Button { withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.86)) { model.floatingExpanded.toggle(); model.onFloatingLayout?() } } label: {
                    Image(systemName: model.floatingExpanded ? "chevron.down" : "chevron.up").font(.system(size: 9, weight: .bold)).foregroundStyle(.secondary).frame(width: 22, height: 22).background(Color.primary.opacity(0.07), in: Circle())
                }.buttonStyle(.plain).help(model.floatingExpanded ? "折叠" : "展开设置")
            }
            if model.floatingExpanded {
                Rectangle().fill(Color.primary.opacity(0.07)).frame(height: 0.5)
                VStack(alignment: .leading, spacing: 8) {
                    HStack { Text("接收文件").font(.system(size: 11, weight: .semibold)); Spacer(); Image(systemName: "sparkle").foregroundStyle(Color.accentColor.opacity(0.8)) }
                    Picker("Bot", selection: $model.floatingBotId) { Text("选择 Bot").tag(""); ForEach(model.bots) { bot in Text(bot.name).tag(bot.id) } }.labelsHidden().frame(maxWidth: .infinity).onChange(of: model.floatingBotId) { _ in model.saveFloating() }
                    TextField("输入收到文件后的处理提示词…", text: $model.floatingPrompt, axis: .vertical).lineLimit(3...4).textFieldStyle(.plain).font(.system(size: 12)).padding(10).frame(maxWidth: .infinity, alignment: .leading).background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 11)).onChange(of: model.floatingPrompt) { _ in model.saveFloating() }
                    HStack { Text("透明度").font(.system(size: 11)).foregroundStyle(.secondary); Slider(value: $model.floatingOpacity, in: 0.35...1).onChange(of: model.floatingOpacity) { _ in model.saveFloating(); model.onFloatingLayout?() } }
                }
                Spacer(minLength: 0)
                HStack(alignment: .center) {
                    Text(model.floatingStatus.isEmpty ? "拖入文件后按提示词派发" : model.floatingStatus).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(2)
                    Spacer(minLength: 4)
                    Button { model.onFloating?() } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary).frame(width: 23, height: 23).background(Color.primary.opacity(0.06), in: Circle()) }.buttonStyle(.plain).help("关闭悬浮球")
                }
            }
        }.padding(model.floatingExpanded ? 14 : 4).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: model.floatingExpanded ? 22 : 35, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: model.floatingExpanded ? 22 : 35, style: .continuous).strokeBorder(dropTarget ? Color.accentColor.opacity(0.65) : Color.white.opacity(0.22), lineWidth: dropTarget ? 1.5 : 0.7))
            .clipShape(RoundedRectangle(cornerRadius: model.floatingExpanded ? 22 : 35, style: .continuous))
            .padding(3)
            .animation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.78), value: dropTarget)
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: busy)
            .onDrop(of: [UTType.fileURL.identifier], isTargeted: $dropTarget) { providers in
                guard !model.quickBusy, !dropLoading, !model.floatingBotId.isEmpty, !model.floatingPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    model.floatingStatus = "先设置 Bot 和文件处理提示词。"
                    if !model.floatingExpanded { model.floatingExpanded = true; model.onFloatingLayout?() }
                    return false
                }
                let items = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
                guard !items.isEmpty, items.count <= 100 else { return false }
                let botId = model.floatingBotId, prompt = model.floatingPrompt
                dropLoading = true; model.floatingStatus = ""
                let group = DispatchGroup(); let lock = NSLock(); var paths: [String] = []
                for item in items { group.enter(); item.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { value, _ in
                    let url: URL? = (value as? URL) ?? (value as? Data).flatMap { URL(dataRepresentation: $0, relativeTo: nil) } ?? (value as? String).flatMap { URL(string: $0) }
                    if let url = url, url.isFileURL { lock.lock(); paths.append(url.path); lock.unlock() }; group.leave()
                } }
                group.notify(queue: .main) { dropLoading = false; if paths.count == items.count { model.quickSend(botId: botId, text: prompt, files: paths, source: "floating") } else { model.floatingStatus = "文件读取失败，请重新拖入。" } }
                return true
            }
    }
    var avatar: some View {
        ZStack {
            Circle().fill(Color.accentColor.opacity(dropTarget ? 0.16 : 0.05)).frame(width: 53, height: 53).scaleEffect(dropTarget && !reduceMotion ? 1.08 : 1)
            if let bot = current {
                BotAvatar(model: model, bot: bot, size: 42).scaleEffect(dropTarget && !reduceMotion ? 0.88 : 1).contentShape(Circle()).onTapGesture { model.select(bot) }
                    .gesture(DragGesture(minimumDistance: 5).onChanged { model.onFloatingMove?($0.translation, false) }.onEnded { model.onFloatingMove?($0.translation, true) }).help("点击打开聊天；拖动移动悬浮球")
            } else { Image(systemName: "person.crop.circle").font(.system(size: 30)).foregroundStyle(.secondary) }
            if dropTarget || busy || !model.floatingStatus.isEmpty {
                let symbol = dropTarget ? "doc.fill" : busy ? "ellipsis" : model.floatingStatus.hasPrefix("已加入") ? "checkmark" : "exclamationmark"
                Image(systemName: symbol).font(.system(size: 9, weight: .bold)).foregroundStyle(.white).frame(width: 19, height: 19).background(Color.accentColor, in: Circle()).offset(x: 17, y: 17).transition(.scale.combined(with: .opacity))
            }
        }.frame(width: 53, height: 53)
    }
}
struct BottomBarView: View {
    @ObservedObject var model: Model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focused: Bool
    @State private var selectingBot = false
    var bot: Bot? { model.bots.first { $0.id == model.barBotId } }
    var body: some View {
        HStack(alignment: .center, spacing: 15) {
            Button { selectingBot.toggle() } label: {
                VStack(spacing: 5) {
                    if let bot = bot { BotAvatar(model: model, bot: bot, size: 38).id(bot.id).transition(.opacity.combined(with: .scale(scale: 0.9))) }
                    else { Image(systemName: "person.crop.circle").font(.system(size: 32)).frame(width: 38, height: 38).foregroundStyle(.secondary) }
                    HStack(spacing: 3) { Text(bot?.name ?? "选择 Bot").lineLimit(1); Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .semibold)) }.font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                }.frame(width: 100, height: 70).contentShape(Rectangle())
            }.buttonStyle(.plain).help("切换 Bot").popover(isPresented: $selectingBot, arrowEdge: .top) {
                ScrollView { VStack(spacing: 3) { ForEach(model.bots) { candidate in
                    Button { withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { model.barBotId = candidate.id }; selectingBot = false } label: {
                        HStack(spacing: 9) { BotAvatar(model: model, bot: candidate, size: 28); Text(candidate.name).lineLimit(1); Spacer(); if candidate.id == model.barBotId { Image(systemName: "checkmark").foregroundStyle(Color.accentColor) } }.padding(.horizontal, 8).padding(.vertical, 5).contentShape(Rectangle())
                    }.buttonStyle(.plain)
                } }.padding(8) }.frame(width: 220, height: min(300, CGFloat(max(1, model.bots.count)) * 42 + 16))
            }
            Rectangle().fill(Color.primary.opacity(0.08)).frame(width: 1, height: 42)
            VStack(alignment: .leading, spacing: 7) {
                TextField("输入问题…", text: $model.barText).textFieldStyle(.plain).font(.system(size: 14)).focused($focused).onSubmit { submit() }
                if !model.quickMessage.isEmpty { Text(model.quickMessage).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Button { submit() } label: { Image(systemName: "arrow.up").font(.system(size: 14, weight: .bold)).foregroundStyle(.white).frame(width: 34, height: 34).background(Color.accentColor, in: Circle()) }
                .buttonStyle(.plain).disabled(model.quickBusy || model.barBotId.isEmpty || model.barText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).opacity(model.quickBusy || model.barBotId.isEmpty || model.barText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.4 : 1)
        }.padding(.horizontal, 14).padding(.vertical, 9)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 23, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 23, style: .continuous).strokeBorder(Color.white.opacity(0.2), lineWidth: 0.7))
            .clipShape(RoundedRectangle(cornerRadius: 23, style: .continuous))
            .padding(3).frame(maxWidth: .infinity, maxHeight: .infinity).onAppear { focused = true }
    }
    func submit() { model.quickSend(botId: model.barBotId, text: model.barText, files: [], source: "bar") }
}
struct ChatBotSidebar: View {
    @ObservedObject var model: Model
    var body: some View {
        ScrollView { VStack(alignment: .leading, spacing: 14) {
            HStack { Text("Bot 设置").font(.headline); Spacer(); Button { model.showBotSettings = false; model.onResize?(model.expanded) } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).help("关闭设置栏") }
            BotSettings(model: model, botId: model.selected).environment(\.compactBotSettings, true)
        }.padding(16) }.background(.regularMaterial)
    }
}
// Soft annular petals rather than a ring of unrelated buttons.
struct WheelPetal: Shape {
    let index: Int
    let count: Int
    let inner: CGFloat
    let outer: CGFloat
    func path(in rect: CGRect) -> Path {
        guard count > 0 else { return Path() }
        let side = min(rect.width, rect.height), center = CGPoint(x: rect.midX, y: rect.midY)
        let innerRadius = side * inner, outerRadius = side * outer
        let step = 2 * CGFloat.pi / CGFloat(count), middle = CGFloat(index) * step - .pi / 2
        let gap = min(CGFloat(0.048), step * 0.10), start = middle - step / 2 + gap, end = middle + step / 2 - gap
        let corner = min(CGFloat(18), (outerRadius - innerRadius) * 0.30, (end - start) * innerRadius * 0.32)
        let outerInset = corner / outerRadius, innerInset = corner / innerRadius
        func point(_ r: CGFloat, _ a: CGFloat) -> CGPoint { CGPoint(x: center.x + cos(a) * r, y: center.y + sin(a) * r) }
        var path = Path()
        path.move(to: point(innerRadius, start + innerInset))
        path.addQuadCurve(to: point(innerRadius + corner, start), control: point(innerRadius, start))
        path.addLine(to: point(outerRadius - corner, start))
        path.addQuadCurve(to: point(outerRadius, start + outerInset), control: point(outerRadius, start))
        let outerStart = start + outerInset, outerEnd = end - outerInset
        for i in 1...18 { path.addLine(to: point(outerRadius, outerStart + (outerEnd - outerStart) * CGFloat(i) / 18)) }
        path.addQuadCurve(to: point(outerRadius - corner, end), control: point(outerRadius, end))
        path.addLine(to: point(innerRadius + corner, end))
        path.addQuadCurve(to: point(innerRadius, end - innerInset), control: point(innerRadius, end))
        let innerStart = end - innerInset, innerEnd = start + innerInset
        for i in 1...18 { path.addLine(to: point(innerRadius, innerStart + (innerEnd - innerStart) * CGFloat(i) / 18)) }
        path.closeSubpath(); return path
    }
}
struct WheelSelection: Equatable { let index: Int; let outer: Bool }
func wheelSelection(at point: CGPoint, side: CGFloat, count: Int) -> WheelSelection? {
    guard count > 0 && side > 0 else { return nil }
    let dx = point.x - side / 2, dy = point.y - side / 2, distance = hypot(dx, dy) / side
    guard distance >= 0.15 && distance <= 0.465 else { return nil }
    let outer = distance >= 0.315, slots = outer ? 7 : 6
    let step = 2 * CGFloat.pi / CGFloat(slots)
    var angle = atan2(dy, dx) + .pi / 2 + step / 2
    angle = angle.truncatingRemainder(dividingBy: 2 * .pi); if angle < 0 { angle += 2 * .pi }
    return WheelSelection(index: min(slots - 1, Int(angle / step)), outer: outer)
}
struct WheelView: View {
    @ObservedObject var model: Model
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selection: WheelSelection?
    @State private var innerShown = false
    @State private var outerShown = false
    @State private var dragging = false
    var spring: Animation { reduceMotion ? .easeOut(duration: 0.01) : .spring(response: 0.48, dampingFraction: 0.78) }
    func choose(_ selection: WheelSelection?) {
        guard let selection = selection, let bot = model.wheelBot(selection.outer ? "outer" : "inner", selection.index) else { return }
        model.select(bot)
    }
    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height), center = side / 2
            ZStack {
                Circle().fill(.ultraThinMaterial).padding(side * 0.025)
                Circle().fill(colorScheme == .dark ? Color.black.opacity(0.18) : Color.white.opacity(0.16)).padding(side * 0.025)
                ForEach(0..<6, id: \.self) { index in
                    ZStack {
                        petal(index: index, count: 6, ring: "inner", side: side)
                        petalContent(index: index, count: 6, ring: "inner", side: side, center: center)
                    }.scaleEffect(innerShown ? 1 : 0.78).opacity(innerShown ? 1 : 0)
                        .animation(reduceMotion ? nil : spring.delay(Double(index) * 0.018), value: innerShown)
                }
                ForEach(0..<7, id: \.self) { index in
                    ZStack {
                        petal(index: index, count: 7, ring: "outer", side: side)
                        petalContent(index: index, count: 7, ring: "outer", side: side, center: center)
                    }.scaleEffect(outerShown ? 1 : 0.82).opacity(outerShown ? 1 : 0)
                        .animation(reduceMotion ? nil : spring.delay(Double(index) * 0.018), value: outerShown)
                }
                Circle().fill(colorScheme == .dark ? Color.white.opacity(0.06) : Color.white.opacity(0.22)).overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 0.8)).frame(width: side * 0.28, height: side * 0.28).allowsHitTesting(false)
            }.frame(width: side, height: side)
                .onAppear {
                    withAnimation(spring) { innerShown = true }
                    if reduceMotion { outerShown = true } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.075) { withAnimation(spring) { outerShown = true } } }
                }
                .onContinuousHover { phase in
                    guard !dragging else { return }
                    switch phase { case .active(let point): withAnimation(spring) { selection = wheelSelection(at: point, side: side, count: 1) }; case .ended: withAnimation(spring) { selection = nil } }
                }
                .gesture(DragGesture(minimumDistance: 8).onChanged { value in
                    dragging = true; withAnimation(spring) { selection = wheelSelection(at: value.location, side: side, count: 1) }
                }.onEnded { _ in let chosen = selection; dragging = false; choose(chosen) })
        }.padding(4)
    }
    @ViewBuilder func petalContent(index: Int, count: Int, ring: String, side: CGFloat, center: CGFloat) -> some View {
        let angle = CGFloat(index) * 2 * .pi / CGFloat(count) - .pi / 2, radius = side * (ring == "outer" ? 0.39 : 0.23)
        let bot = model.wheelBot(ring, index)
        VStack(spacing: 5) {
            if let bot = bot { BotAvatar(model: model, bot: bot, size: ring == "outer" ? 31 : 29); Text(bot.name).font(.system(size: 10, weight: .semibold)).lineLimit(1).frame(width: 75) }
            else { Image(systemName: "plus").font(.system(size: 14, weight: .medium)).foregroundStyle(.secondary); Text("未设置").font(.system(size: 9)).foregroundStyle(.secondary) }
        }.position(x: center + cos(angle) * radius, y: center + sin(angle) * radius).allowsHitTesting(false)
    }
    @ViewBuilder func petal(index: Int, count: Int, ring: String, side: CGFloat) -> some View {
        let outer = ring == "outer", shape = WheelPetal(index: index, count: count, inner: outer ? 0.315 : 0.15, outer: outer ? 0.465 : 0.305)
        let selected = selection == WheelSelection(index: index, outer: outer), bot = model.wheelBot(ring, index)
        Button { choose(WheelSelection(index: index, outer: outer)) } label: {
            shape.fill(colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.26))
                .overlay(shape.fill(Color.accentColor.opacity(selected ? 0.20 : 0)))
                .overlay(shape.stroke(Color.white.opacity(selected ? 0.55 : 0.22), lineWidth: selected ? 1 : 0.6))
                .scaleEffect(selected && !reduceMotion ? 1.02 : 1).contentShape(shape)
        }.buttonStyle(.plain).disabled(bot == nil).accessibilityLabel(bot.map { "与\($0.name)对话" } ?? "未设置的轮盘位置")
    }
}
final class PanelHostingView: NSHostingView<PanelView> { weak var panelModel: Model? }
final class KeyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override func cancelOperation(_ sender: Any?) { orderOut(nil) }
}
final class Controller: NSObject, NSWindowDelegate {
    let model = Model(); var panel: NSPanel!; var chatPanel: NSPanel?; var floatingPanel: NSPanel?; var barPanel: NSPanel?; var settingsWindow: NSWindow?; var expanded = false
    var floatingDragOrigin: NSPoint?
    var panelEffect: PanelHostingView!
    var wheelHost: NSHostingView<PanelView>!
    var capturingScreen = false
    override init() {
        super.init()
        panel = KeyPanel(contentRect: NSRect(x: 0, y: 0, width: 330, height: 510), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false; panel.backgroundColor = .clear; panel.hasShadow = true; panel.level = .floating; panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; panel.acceptsMouseMovedEvents = true; panel.delegate = self
        let host = PanelHostingView(rootView: PanelView(model: model)); host.panelModel = model; host.wantsLayer = true; host.layer?.backgroundColor = NSColor.clear.cgColor
        panel.contentView = host; panelEffect = host; panel.hasShadow = false
        wheelHost = NSHostingView(rootView: PanelView(model: model)); wheelHost.wantsLayer = true; wheelHost.layer?.backgroundColor = NSColor.clear.cgColor
        model.onBar = { [weak self] in self?.toggleBar() }
        model.onCapture = { [weak self] in self?.captureScreen() }
        model.onFloating = { [weak self] in self?.toggleFloating() }
        model.onFloatingLayout = { [weak self] in self?.layoutFloating() }
        model.onFloatingMove = { [weak self] translation, ended in self?.moveFloating(translation, ended: ended) }
        model.onStagingFiles = { [weak self] in
            guard let self = self else { return }
            self.model.pickingFiles = true
            let picker = NSOpenPanel(); picker.canChooseFiles = true; picker.canChooseDirectories = false; picker.allowsMultipleSelection = true
            picker.beginSheetModal(for: self.panel) { result in
                if result == .OK { self.model.stage(text: "", files: picker.urls) }
                self.model.pickingFiles = false; self.panel.makeKeyAndOrderFront(nil)
            }
        }
        model.onResize = { [weak self] expand in self?.resize(expand) }
        model.onOpenChat = { [weak self] in self?.openChat() }
        model.onBackToList = { [weak self] in self?.chatPanel?.orderOut(nil); self?.show("list", [:]) }
        model.onChooseFiles = { [weak self] in
            guard let self = self else { return }
            self.model.pickingFiles = true
            let picker = NSOpenPanel(); picker.canChooseFiles = true; picker.canChooseDirectories = false; picker.allowsMultipleSelection = true
            guard let chat = self.chatPanel else { self.model.pickingFiles = false; return }
            picker.beginSheetModal(for: chat) { result in
                if result == .OK { self.model.addAttachments(picker.urls) }
                self.model.pickingFiles = false; chat.makeKeyAndOrderFront(nil)
            }
        }
    }
    func toggleBar() {
        if let bar = barPanel, bar.isVisible { bar.orderOut(nil); return }
        if !model.bots.contains(where: { $0.id == model.barBotId }) { model.barBotId = model.selected.isEmpty ? (model.bots.first?.id ?? "") : model.selected }
        if barPanel == nil {
            let bar = KeyPanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 78), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            bar.isOpaque = false; bar.backgroundColor = .clear; bar.level = .floating; bar.isReleasedWhenClosed = false; bar.hasShadow = true
            bar.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; bar.delegate = self
            let host = NSHostingView(rootView: BottomBarView(model: model)); host.wantsLayer = true; host.layer?.backgroundColor = NSColor.clear.cgColor
            bar.hasShadow = false; bar.contentView = host; barPanel = bar
        }
        guard let bar = barPanel else { return }
        let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main
        let area = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800), width = min(560, area.width)
        bar.setFrame(NSRect(x: area.midX - width / 2, y: area.minY + min(120, max(70, area.height * 0.14)), width: width, height: 100), display: true)
        model.quickMessage = ""; NSApp.activate(ignoringOtherApps: true); bar.makeKeyAndOrderFront(nil)
    }
    func captureScreen() {
        guard !capturingScreen else { return }
        capturingScreen = true
        let chatWasVisible = chatPanel?.isVisible == true, floatWasVisible = floatingPanel?.isVisible == true
        panel.orderOut(nil); chatPanel?.orderOut(nil); floatingPanel?.orderOut(nil)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("grok-capture-" + UUID().uuidString, isDirectory: true)
        do { try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
        catch { capturingScreen = false; model.quickMessage = "无法创建截图临时目录。"; show("list", [:]); return }
        let target = folder.appendingPathComponent("截图.png")
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture"); process.arguments = ["-i", "-x", target.path]
        process.terminationHandler = { [weak self] process in DispatchQueue.main.async {
            guard let self = self else { try? FileManager.default.removeItem(at: folder); return }
            self.capturingScreen = false
            if floatWasVisible { self.floatingPanel?.orderFront(nil) }
            if chatWasVisible && self.model.pinned { self.chatPanel?.orderFront(nil) }
            defer { try? FileManager.default.removeItem(at: folder) }
            guard process.terminationStatus == 0, FileManager.default.fileExists(atPath: target.path) else { self.model.quickMessage = "截图已取消或未能取得画面；如需授权，请检查系统屏幕录制权限。"; self.show("list", [:]); return }
            let before = self.model.staged.count; self.model.stage(text: "", files: [target])
            if self.model.staged.count > before { self.model.screenshotItem = self.model.staged.last; self.show("screenshot", [:]) }
            else { self.show("staging", [:]) }
        } }
        do { try process.run() } catch { capturingScreen = false; try? FileManager.default.removeItem(at: folder); if floatWasVisible { floatingPanel?.orderFront(nil) }; model.quickMessage = "无法启动系统截图。"; show("list", [:]) }
    }
    func toggleFloating() {
        if let floating = floatingPanel, floating.isVisible { floating.orderOut(nil); model.floatingVisible = false; return }
        if !model.bots.contains(where: { $0.id == model.floatingBotId }) { model.floatingBotId = model.bot?.id ?? model.bots.first?.id ?? "" }
        if floatingPanel == nil {
            let float = KeyPanel(contentRect: NSRect(x: 0, y: 0, width: 250, height: 260), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            float.isOpaque = false; float.backgroundColor = .clear; float.hasShadow = false; float.level = .floating; float.isReleasedWhenClosed = false
            float.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; float.delegate = self
            float.contentView = NSHostingView(rootView: FloatingBotView(model: model)); floatingPanel = float
            let visible = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
            float.setFrameOrigin(NSPoint(x: visible.maxX - 260, y: visible.midY))
        }
        layoutFloating(); floatingPanel?.orderFrontRegardless(); model.floatingVisible = true
    }
    func layoutFloating() {
        guard let float = floatingPanel else { return }
        let old = float.frame, size = model.floatingExpanded ? NSSize(width: 270, height: 330) : NSSize(width: 94, height: 76)
        let screen = NSScreen.screens.first(where: { $0.frame.intersects(old) }) ?? NSScreen.main
        let visible = screen?.visibleFrame ?? old
        let x = min(max(visible.minX, old.maxX - size.width), visible.maxX - size.width)
        let y = min(max(visible.minY, old.maxY - size.height), visible.maxY - size.height)
        float.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)
        float.alphaValue = CGFloat(model.floatingOpacity)
    }
    func moveFloating(_ translation: CGSize, ended: Bool) {
        guard let float = floatingPanel else { return }
        if floatingDragOrigin == nil { floatingDragOrigin = float.frame.origin }
        guard let start = floatingDragOrigin else { return }
        var origin = NSPoint(x: start.x + translation.width, y: start.y - translation.height)
        if ended {
            let screen = NSScreen.screens.first(where: { $0.frame.intersects(float.frame) }) ?? NSScreen.main
            if let visible = screen?.visibleFrame {
                origin.x = min(max(visible.minX, origin.x), visible.maxX - float.frame.width)
                origin.y = min(max(visible.minY, origin.y), visible.maxY - float.frame.height)
                let left = abs(origin.x - visible.minX), right = abs(visible.maxX - (origin.x + float.frame.width))
                if min(left, right) < 45 { origin.x = left < right ? visible.minX : visible.maxX - float.frame.width }
            }
            floatingDragOrigin = nil
        }
        float.setFrameOrigin(origin)
    }
    func windowDidResignKey(_ notification: Notification) {
        guard let source = notification.object as? NSWindow else { return }
        if source === chatPanel && !model.pinned && !model.pickingFiles && ((model.snapshot["composerPrefs"] as? [String: Any])?["dismissOnOutside"] as? Bool ?? true) { chatPanel?.orderOut(nil) }
    }
    func openChat() {
        let sourceFrame = panel.frame
        panel.orderOut(nil)
        if chatPanel == nil {
            let chat = KeyPanel(contentRect: NSRect(x: 0, y: 0, width: 370, height: 590), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
            chat.isOpaque = false; chat.backgroundColor = .clear; chat.hasShadow = true; chat.level = .floating; chat.isReleasedWhenClosed = false
            chat.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]; chat.delegate = self; chat.isMovableByWindowBackground = true
            let host = NSHostingView(rootView: ChatWindowView(model: model)); host.wantsLayer = true; host.layer?.backgroundColor = NSColor.clear.cgColor
            chat.hasShadow = false; chat.contentView = host; chatPanel = chat
        }
        guard let chat = chatPanel else { return }
        if !(chat.isVisible && model.pinned) {
            let visible = (NSScreen.screens.first { $0.frame.intersects(sourceFrame) } ?? NSScreen.main)?.visibleFrame ?? sourceFrame
            let size = NSSize(width: 370, height: min(590, visible.height))
            let x = min(max(visible.minX, sourceFrame.midX - size.width / 2), visible.maxX - size.width)
            let y = min(max(visible.minY, sourceFrame.maxY - size.height), visible.maxY - size.height)
            chat.setFrame(NSRect(origin: NSPoint(x: x, y: y), size: size), display: true)
        }
        NSApp.activate(ignoringOtherApps: true); chat.makeKeyAndOrderFront(nil)
    }
    func showSettings(_ section: String, _ botId: String) {
        panel.orderOut(nil); model.settingsSection = section
        if !botId.isEmpty { model.settingsBot = botId }
        if settingsWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 820, height: 640), styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.title = "设置"; window.titlebarAppearsTransparent = true; window.titleVisibility = .hidden
            window.minSize = NSSize(width: 700, height: 500); window.isReleasedWhenClosed = false
            window.contentView = NSHostingView(rootView: SettingsView(model: model)); window.center(); settingsWindow = window
        }
        NSApp.activate(ignoringOtherApps: true); settingsWindow?.makeKeyAndOrderFront(nil)
    }
    func resize(_ expand: Bool) {
        expanded = expand; model.expanded = expand
        guard let chat = chatPanel else { return }
        let w: CGFloat = (expand ? 620 : 370) + (model.showBotSettings ? 300 : 0), h: CGFloat = expand ? 740 : 590
        let old = chat.frame, visible = (NSScreen.screens.first { $0.frame.intersects(old) } ?? NSScreen.main)?.visibleFrame ?? old
        let width = min(w, visible.width), height = min(h, visible.height)
        let x = min(max(visible.minX, old.minX), visible.maxX - width), y = min(max(visible.minY, old.maxY - height), visible.maxY - height)
        chat.setFrame(NSRect(x: x, y: y, width: width, height: height), display: true, animate: true)
    }
    func show(_ mode: String, _ anchor: [String: Any]) {
        if panel.isVisible && (model.mode == mode || mode == "list") && mode != "chat" { panel.orderOut(nil); return }
        if mode == "wheel" { model.wheelGeneration += 1 }
        model.mode = mode; model.error = ""; if !(model.pinned && chatPanel?.isVisible == true) { model.expanded = false }; panel.isMovableByWindowBackground = false
        let size: CGFloat = mode == "wheel" ? 440 : 0
        let w: CGFloat = size > 0 ? size : 330, h: CGFloat = size > 0 ? size : 510
        let pointer = NSEvent.mouseLocation
        let target = NSScreen.screens.first(where: { $0.frame.contains(pointer) }) ?? NSScreen.main
        let visible = target?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let x = (anchor["x"] as? NSNumber)?.doubleValue ?? Double(pointer.x), top = (anchor["y"] as? NSNumber)?.doubleValue
        let isMenu = mode == "list" && top != nil
        let screenTop = NSScreen.screens.first?.frame.maxY ?? visible.maxY
        let proposedY = isMenu ? screenTop - CGFloat(top!) - CGFloat((anchor["height"] as? NSNumber)?.doubleValue ?? 0) - h - 4 : pointer.y - h/2
        let originX = max(visible.minX, min(visible.maxX-w, CGFloat(x)-w/2))
        let originY = max(visible.minY, min(visible.maxY-h, proposedY))
        panel.contentView = mode == "wheel" ? wheelHost : panelEffect
        panel.hasShadow = false
        panel.setFrame(NSRect(x: originX, y: originY, width: w, height: h), display: true)
        panel.contentView?.layer?.cornerRadius = mode == "wheel" ? w / 2 : 18
        // The hosting view has no rectangular backdrop; mask the window content
        // to the panel silhouette as well as clipping the SwiftUI material.
        if let layer = panel.contentView?.layer {
            let mask = CAShapeLayer()
            mask.path = (mode == "wheel" ? CGPath(ellipseIn: CGRect(x: 0, y: 0, width: w, height: h), transform: nil) : CGPath(roundedRect: CGRect(x: 0, y: 0, width: w, height: h), cornerWidth: 18, cornerHeight: 18, transform: nil))
            layer.mask = mask
        }
        let animateEntry = !panel.isVisible && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        if animateEntry { panel.alphaValue = 0 }
        NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
        if animateEntry { NSAnimationContext.runAnimationGroup { context in context.duration = 0.24; context.timingFunction = CAMediaTimingFunction(name: .easeOut); panel.animator().alphaValue = 1 } } else { panel.alphaValue = 1 }
    }
}
let app = NSApplication.shared; app.setActivationPolicy(.accessory)
let controller = Controller()
DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8), let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let command = value["command"] as? String else { continue }
        DispatchQueue.main.async {
            switch command {
            case "state": controller.model.update(value)
            case "avatars": controller.model.setAvatars(value["images"] as? [String: String] ?? [:] )
            case "avatar": controller.model.setAvatar(id: value["botId"] as? String ?? "", raw: value["png"] as? String ?? "")
            case "show": controller.show(value["mode"] as? String ?? "list", value["anchor"] as? [String: Any] ?? [:])
            case "toggleBar": controller.toggleBar()
            case "captureScreen": controller.captureScreen()
            case "quickSendResult": controller.model.quickBusy = false; controller.model.quickMessage = value["message"] as? String ?? ""; if controller.model.quickSource == "floating" { controller.model.floatingStatus = controller.model.quickMessage }; if value["ok"] as? Bool == true && controller.model.quickSource == "bar" && controller.model.barText == controller.model.quickText { controller.model.barText = "" }; controller.model.quickSource = ""; controller.model.quickText = ""
            case "sendResult": controller.model.result(value)
            case "taskResult":
                controller.model.taskCreating = false
                controller.model.taskMessage = value["message"] as? String ?? ""
                if value["ok"] as? Bool == true && controller.model.mode == "task-create" { controller.model.mode = "tasks" }
            case "openChat":
                if let botId = value["botId"] as? String, let bot = controller.model.bots.first(where: { $0.id == botId }) {
                    controller.model.select(bot)
                    if let text = value["text"] as? String { controller.model.draft = text }
                    if let paths = value["files"] as? [String] { controller.model.addAttachments(paths.map { URL(fileURLWithPath: $0) }) }
                    if let item = value["receipt"] as? [String: Any] { controller.model.draft = item["text"] as? String ?? ""; controller.model.receiptId = item["id"] as? String ?? ""; controller.model.remoteFiles = (item["files"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String } }
                }
            case "receipt":
                if let item = value["receipt"] as? [String: Any], let botId = item["botId"] as? String, let bot = controller.model.bots.first(where: { $0.id == botId }) {
                    controller.model.select(bot); controller.model.draft = item["text"] as? String ?? ""; controller.model.receiptId = item["id"] as? String ?? ""
                    controller.model.remoteFiles = (item["files"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String }
                    controller.resize(false)
                }
            case "showSettings": controller.showSettings(value["section"] as? String ?? "general", value["botId"] as? String ?? "")
            case "settingsResult": controller.model.settingsMessage = value["message"] as? String ?? ""
            case "hide": controller.panel.orderOut(nil)
            case "testChatFeatures":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1", let path = value["path"] as? String, let bot = controller.model.bots.first {
                    controller.show("wheel", [:]); controller.model.select(bot)
                    controller.model.pinned = true; controller.show("wheel", [:])
                    let pinned = controller.chatPanel?.isVisible == true
                    controller.model.showBotSettings = true; controller.resize(false)
                    let sidebar = (controller.chatPanel?.frame.width ?? 0) >= 650
                    controller.model.addAttachments([URL(fileURLWithPath: path), URL(fileURLWithPath: path)])
                    let deduplicated = controller.model.attachments.count == 1
                    controller.model.draft = ""; controller.model.send(); controller.model.result(["ok": false])
                    let retained = controller.model.attachments.count == 1
                    controller.model.send(); controller.model.result(["ok": true])
                    emit("testChatResult", ["pinned": pinned, "sidebar": sidebar, "deduplicated": deduplicated, "retained": retained, "cleared": controller.model.attachments.isEmpty])
                }
            case "testCapture":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1", let path = value["path"] as? String, let mode = value["mode"] as? String, ["list", "wheel", "bar", "settings"].contains(mode) {
                    if mode == "bar" { controller.toggleBar() }
                    else if mode == "settings" { controller.showSettings("general", "") }
                    else { controller.show(mode, [:]) }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        let window: NSWindow? = mode == "bar" ? controller.barPanel : mode == "settings" ? controller.settingsWindow : controller.panel
                        guard let window = window, let image = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(window.windowNumber), [.boundsIgnoreFraming, .bestResolution]) else { emit("testCaptureResult", ["ok": false]); return }
                        let bitmap = NSBitmapImageRep(cgImage: image)
                        guard let png = bitmap.representation(using: .png, properties: [:]) else { emit("testCaptureResult", ["ok": false]); return }
                        do { try png.write(to: URL(fileURLWithPath: path), options: .atomic); emit("testCaptureResult", ["ok": true, "mode": mode]) }
                        catch { emit("testCaptureResult", ["ok": false]) }
                    }
                }
            case "testPanels":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1" {
                    controller.show("list", [:]); let shown = controller.panel.isVisible
                    controller.show("list", [:]); let hidden = !controller.panel.isVisible
                    controller.show("wheel", [:]); let wheelClear = controller.panel.contentView === controller.wheelHost && !controller.panel.hasShadow
                    controller.panel.orderOut(nil); controller.toggleBar(); let barShown = controller.barPanel?.isVisible == true
                    let barClear = controller.barPanel?.contentView is NSHostingView<BottomBarView> && controller.barPanel?.hasShadow == false
                    let previous = controller.model.barBotId
                    if let last = controller.model.bots.last { controller.model.barBotId = last.id }
                    let avatarFollows = BottomBarView(model: controller.model).bot?.id == controller.model.barBotId
                    controller.model.barBotId = previous
                    controller.toggleBar(); let barHidden = controller.barPanel?.isVisible == false
                    emit("testPanelsResult", ["shown": shown, "hidden": hidden, "wheelClear": wheelClear, "barShown": barShown, "barHidden": barHidden, "barClear": barClear, "avatarFollows": avatarFollows])
                }
            case "testFloating":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1" {
                    controller.toggleFloating(); let visible = controller.floatingPanel?.isVisible == true
                    controller.model.floatingExpanded = false; controller.layoutFloating()
                    let collapsed = controller.floatingPanel?.frame.width == 94
                    controller.model.floatingExpanded = true; controller.layoutFloating()
                    let expanded = controller.floatingPanel?.frame.width == 270
                    controller.toggleFloating(); let hidden = controller.floatingPanel?.isVisible == false
                    emit("testFloatingResult", ["visible": visible, "collapsed": collapsed, "expanded": expanded, "hidden": hidden])
                }
            case "testStaging":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1", let path = value["path"] as? String {
                    let m = controller.model
                    m.stage(text: "待处理", files: [URL(fileURLWithPath: path)])
                    let item = m.staged.last
                    let copied = item?.files.first.map { FileManager.default.fileExists(atPath: $0) && $0 != path } ?? false
                    let persisted = StagingStore().load().last?.text == "待处理"
                    if let item = item { m.removeStaged(item.id) }
                    emit("testStagingResult", ["copied": copied, "persisted": persisted, "removed": StagingStore().load().isEmpty, "originalIntact": FileManager.default.fileExists(atPath: path)])
                }
            case "testWheelGeometry":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1" {
                    let side: CGFloat = 440, rect = CGRect(x: 0, y: 0, width: side, height: side)
                    var passed = wheelSelection(at: CGPoint(x: 220, y: 220), side: side, count: 6) == nil
                    var checks = 0
                    for outer in [false, true] { let count = outer ? 7 : 6; for index in 0..<count {
                        let radius: CGFloat = side * (outer ? 0.39 : 0.225)
                        let angle = CGFloat(index) * 2 * .pi / CGFloat(count) - .pi / 2
                        let point = CGPoint(x: side / 2 + cos(angle) * radius, y: side / 2 + sin(angle) * radius)
                        let hit = wheelSelection(at: point, side: side, count: 1)
                        let shape = WheelPetal(index: index, count: count, inner: outer ? 0.315 : 0.15, outer: outer ? 0.465 : 0.305)
                        if hit != WheelSelection(index: index, outer: outer) || !shape.path(in: rect).contains(point) { passed = false }
                        checks += 1
                    } }
                    emit("testWheelResult", ["passed": passed, "checks": checks])
                }
            case "testAvatarState":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1" { emit("testAvatarResult", ["decoded": controller.model.avatarImages.count]) }
            case "testSettings":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1" {
                    controller.showSettings("bots", controller.model.bots.first?.id ?? "")
                    let ok = controller.settingsWindow?.isVisible == true && controller.model.settingsSection == "bots" && !controller.model.settingsBot.isEmpty
                    controller.model.setting("theme", ["theme": "dark"])
                    controller.model.configure(["enabled": true])
                    controller.model.setting("setWheelSlot", ["ring": "outer", "index": 6, "botId": controller.model.settingsBot])
                    controller.model.setting("setShortcut", ["slot": "wheel", "accelerator": "Command+Shift+J"])
                    controller.model.setting("setComposerPrefs", ["afterSend": "open"])
                    emit("testSettingsResult", ["visible": ok, "botCount": controller.model.bots.count])
                }
            case "test":
                if ProcessInfo.processInfo.environment["GROK_NATIVE_TEST"] == "1" {
                    controller.show("list", [:]); let listVisible = controller.panel.isVisible
                    if let bot = controller.model.bots.first { controller.model.select(bot) }
                    let chatReady = controller.model.mode == "chat" && controller.model.bot != nil
                    controller.model.draft = "preview test"; controller.model.send()
                    controller.resize(true); let expanded = (controller.chatPanel?.frame.width ?? 0) > 370
                    controller.show("wheel", [:]); let wheelReady = controller.model.mode == "wheel" && controller.panel.isVisible
                    emit("testResult", ["listVisible": listVisible, "chatReady": chatReady, "expanded": expanded, "wheelReady": wheelReady, "botCount": controller.model.bots.count])
                }
            case "quit": NSApp.terminate(nil)
            default: break
            }
        }
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
}
emit("ready"); app.run()
