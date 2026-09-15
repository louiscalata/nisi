// AFM Agent Tools — on-device MCP + LSP + coding tools via the public FoundationModels API.
// Extends the proven afm-agent pattern with real MCP (JSON-RPC 2.0 over stdio)
// and LSP (Content-Length framing) tool bridges, plus file ops and shell execution.
// Usage:
//   afm-agent-tools "Fix the bug in main.py"
//   afm-agent-tools mcp-list "python3 /path/to/server.py"
//   afm-agent-tools lsp-diag /path/to/file.py
// Compile: xcrun swiftc -parse-as-library -O -o afm-agent-tools afm-agent-tools.swift
import Foundation
import FoundationModels

// MARK: - Transport Helpers

/// Read a newline-delimited line from a file handle (MCP framing).
func readLine(_ handle: FileHandle) -> String? {
    var data = Data()
    while true {
        let byte = handle.readData(ofLength: 1)
        guard !byte.isEmpty else { return nil }
        data.append(byte)
        if byte[0] == UInt8(ascii: "\n") {
            return String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }
}

/// Read a Content-Length-framed JSON-RPC message (LSP framing).
func readLspMessage(_ handle: FileHandle) -> [String: Any]? {
    var headerData = Data()
    while true {
        let byte = handle.readData(ofLength: 1)
        guard !byte.isEmpty else { return nil }
        headerData.append(byte)
        if headerData.count >= 4 {
            let tail = String(data: headerData.suffix(4), encoding: .utf8) ?? ""
            if tail == "\r\n\r\n" { break }
        }
    }
    let header = String(data: headerData, encoding: .utf8) ?? ""
    guard let range = header.range(of: "Content-Length: "),
          let end = header[range.upperBound...].range(of: "\r\n") else { return nil }
    let len = Int(header[range.upperBound..<end.lowerBound]) ?? 0
    guard len > 0, len < 1_000_000 else { return nil }
    let body = handle.readData(ofLength: len)
    return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
}

/// Send a newline-delimited JSON-RPC message (MCP framing).
func sendMcp(_ method: String, params: [String: Any] = [:], id: Int? = nil, to stdin: Pipe) throws {
    var msg: [String: Any] = ["jsonrpc": "2.0", "method": method]
    if let id = id { msg["id"] = id }
    if !params.isEmpty { msg["params"] = params }
    let data = try JSONSerialization.data(withJSONObject: msg)
    guard var line = String(data: data, encoding: .utf8) else { return }
    line.append("\n")
    stdin.fileHandleForWriting.write(Data(line.utf8))
}

/// Send a Content-Length-framed JSON-RPC message (LSP framing).
func sendLsp(_ method: String, params: [String: Any] = [:], id: Int? = nil, to stdin: Pipe) throws {
    var msg: [String: Any] = ["jsonrpc": "2.0", "method": method]
    if let id = id { msg["id"] = id }
    if !params.isEmpty { msg["params"] = params }
    let body = try JSONSerialization.data(withJSONObject: msg)
    let header = "Content-Length: \(body.count)\r\n\r\n"
    stdin.fileHandleForWriting.write(Data(header.utf8))
    stdin.fileHandleForWriting.write(body)
}

// MARK: - MCP Client (newline-delimited JSON-RPC 2.0)

final class McpClient {
    let process: Process
    let stdin: Pipe
    let stdout: Pipe

    init(command: String, args: [String]) throws {
        process = Process()
        // Resolve command via shell to handle relative paths, env vars, etc.
        let fullCmd = ([command] + args).joined(separator: " ")
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-c", fullCmd]
        stdin = Pipe()
        stdout = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = FileHandle.nullDevice
        try process.run()
    }

    func handshake() throws {
        try sendMcp("initialize", params: [
            "protocolVersion": "2025-03-26",
            "capabilities": [:] as [String: Any],
            "clientInfo": ["name": "afm-agent", "version": "0.1"]
        ], id: 1, to: stdin)
        _ = readResponse(id: 1)
        try sendMcp("notifications/initialized", to: stdin)
    }

    func listTools() throws -> [[String: Any]] {
        try sendMcp("tools/list", id: 2, to: stdin)
        let resp = readResponse(id: 2)
        return (resp?["result"] as? [String: Any])?["tools"] as? [[String: Any]] ?? []
    }

    func callTool(_ name: String, arguments: [String: Any]) throws -> String {
        try sendMcp("tools/call", params: ["name": name, "arguments": arguments], id: 3, to: stdin)
        let resp = readResponse(id: 3) ?? [:]
        if let result = resp["result"] as? [String: Any],
           let content = result["content"] as? [[String: Any]],
           let first = content.first,
           let text = first["text"] as? String {
            return text
        }
        if let error = resp["error"] as? [String: Any] {
            return "MCP error: \(error["message"] ?? "unknown")"
        }
        let resultData = (try? JSONSerialization.data(withJSONObject: resp["result"] ?? [:])) ?? Data()
        return String(data: resultData, encoding: .utf8) ?? "{}"
    }

    func close() {
        stdin.fileHandleForWriting.closeFile()
        if process.isRunning { process.terminate() }
    }

    private func readResponse(id: Int) -> [String: Any]? {
        guard let line = readLine(stdout.fileHandleForReading),
              let data = line.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return json
    }
}

// MARK: - LSP Client (Content-Length-framed JSON-RPC 2.0)

final class LspClient {
    let process: Process
    let stdin: Pipe
    let stdout: Pipe

    init(command: String, args: [String]) throws {
        process = Process()
        process.executableURL = URL(fileURLWithPath: command)
        process.arguments = args
        stdin = Pipe()
        stdout = Pipe()
        let stderrPipe = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderrPipe
        try process.run()
    }

    func initialize(rootUri: String? = nil) throws {
        let root = rootUri ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath).absoluteString
        try sendLsp("initialize", params: [
            "processId": ProcessInfo.processInfo.processIdentifier,
            "capabilities": [:] as [String: Any],
            "rootUri": root
        ], id: 1, to: stdin)
        _ = readLspMessage(stdout.fileHandleForReading)
        try sendLsp("initialized", to: stdin)
    }

    func getDiagnostics(for filePath: String) throws -> String {
        let fileUrl = URL(fileURLWithPath: filePath)
        let content = try String(contentsOf: fileUrl, encoding: .utf8)
        let langId: String
        switch fileUrl.pathExtension {
        case "py":    langId = "python"
        case "swift": langId = "swift"
        case "ts":    langId = "typescript"
        case "tsx":   langId = "typescriptreact"
        case "js":    langId = "javascript"
        case "jsx":   langId = "javascriptreact"
        default:      langId = fileUrl.pathExtension
        }
        try sendLsp("textDocument/didOpen", params: [
            "textDocument": [
                "uri": fileUrl.absoluteString,
                "languageId": langId,
                "version": 1,
                "text": content
            ] as [String: Any]
        ], to: stdin)

        // Wait for publishDiagnostics notification (traditional LSP push model)
        let deadline = Date().addingTimeInterval(3.0)
        while Date() < deadline {
            guard let msg = readLspMessage(stdout.fileHandleForReading) else {
                Thread.sleep(forTimeInterval: 0.1)
                continue
            }
            // Check for publishDiagnostics notification
            if let method = msg["method"] as? String,
               method == "textDocument/publishDiagnostics",
               let params = msg["params"] as? [String: Any],
               let uri = params["uri"] as? String,
               uri == fileUrl.absoluteString,
               let diagnostics = params["diagnostics"] as? [[String: Any]],
               !diagnostics.isEmpty {
                return diagnostics.map { diag in
                    let range = diag["range"] as? [String: Any] ?? [:]
                    let start = range["start"] as? [String: Any] ?? [:]
                    let line = (start["line"] as? Int ?? 0) + 1
                    let col = (start["character"] as? Int ?? 0) + 1
                    let msg = diag["message"] as? String ?? ""
                    let severity = diag["severity"] as? Int ?? 1
                    let sev = severity == 1 ? "error" : severity == 2 ? "warning" : "info"
                    return "\(sev) L\(line):\(col) \(msg)"
                }.joined(separator: "\n")
            }
            // Also check for pull diagnostics response (LSP 3.17)
            if let id = msg["id"] as? Int, id == 2 {
                if let result = msg["result"] as? [String: Any],
                   let items = result["items"] as? [[String: Any]], !items.isEmpty {
                    return items.map { item in
                        let range = item["range"] as? [String: Any] ?? [:]
                        let start = range["start"] as? [String: Any] ?? [:]
                        let line = (start["line"] as? Int ?? 0) + 1
                        let col = (start["character"] as? Int ?? 0) + 1
                        let msg = item["message"] as? String ?? ""
                        let severity = item["severity"] as? Int ?? 1
                        let sev = severity == 1 ? "error" : severity == 2 ? "warning" : "info"
                        return "\(sev) L\(line):\(col) \(msg)"
                    }.joined(separator: "\n")
                }
                return "No diagnostics"
            }
        }
        return "No diagnostics received (timeout)"
    }

    func close() {
        stdin.fileHandleForWriting.closeFile()
        if process.isRunning { process.terminate() }
    }
}

// MARK: - Plain Tool Executors (shared by Tool structs and brain-loop executor)

func runCommandSync(_ command: String) -> String {
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
    proc.arguments = ["-c", command]
    let pipe = Pipe()
    proc.standardOutput = pipe
    proc.standardError = pipe
    do { try proc.run() } catch { return "error: \(error.localizedDescription)" }
    proc.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let output = String(data: data, encoding: .utf8) ?? ""
    let exit = proc.terminationStatus
    return exit == 0 ? output : "\(output)\n[exit \(exit)]"
}

func readFileSync(_ path: String) -> String {
    do { return try String(contentsOfFile: path, encoding: .utf8) }
    catch { return "error: \(error.localizedDescription)" }
}

func writeFileSync(_ path: String, _ content: String) -> String {
    do {
        let url = URL(fileURLWithPath: path)
        let dir = url.deletingLastPathComponent()
        if !FileManager.default.fileExists(atPath: dir.path) {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        try content.write(to: url, atomically: true, encoding: .utf8)
        return "Written \(content.count) bytes to \(path)"
    } catch { return "error: \(error.localizedDescription)" }
}

func lspDiagSync(_ filePath: String) async throws -> String {
    let ext = URL(fileURLWithPath: filePath).pathExtension
    let server: (String, [String])
    switch ext {
    case "py":       server = ("/Users/louiscalata/.local/node_modules/.bin/basedpyright-langserver", ["--stdio"])
    case "swift":    server = ("/Library/Developer/CommandLineTools/usr/bin/sourcekit-lsp", [])
    case "ts", "js": server = ("/Users/louiscalata/.local/node_modules/.bin/typescript-language-server", ["--stdio"])
    default: return "Unsupported file type: .\(ext). Supported: .py, .swift, .ts, .js"
    }
    let client = try LspClient(command: server.0, args: server.1)
    defer { client.close() }
    try client.initialize()
    // Pause to let the LSP server start processing
    try await Task.sleep(nanoseconds: 1_000_000_000) // 1.0s
    return try client.getDiagnostics(for: filePath)
}

func mcpListSync(_ serverCommand: String) -> String {
    let parts = serverCommand.split(separator: " ").map(String.init)
    guard let cmd = parts.first else { return "No command provided" }
    do {
        let client = try McpClient(command: cmd, args: Array(parts.dropFirst()))
        defer { client.close() }
        try client.handshake()
        let tools = try client.listTools()
        let data = try JSONSerialization.data(withJSONObject: tools, options: [.prettyPrinted, .sortedKeys])
        return String(data: data, encoding: .utf8) ?? "[]"
    } catch { return "MCP error: \(error.localizedDescription)" }
}

func mcpCallSync(_ serverCommand: String, _ toolName: String, _ argsJSON: String) -> String {
    let parts = serverCommand.split(separator: " ").map(String.init)
    guard let cmd = parts.first else { return "No command provided" }
    do {
        let client = try McpClient(command: cmd, args: Array(parts.dropFirst()))
        defer { client.close() }
        try client.handshake()
        let args = (try? JSONSerialization.jsonObject(with: Data(argsJSON.utf8))) as? [String: Any] ?? [:]
        return try client.callTool(toolName, arguments: args)
    } catch { return "MCP error: \(error.localizedDescription)" }
}

/// Dispatch an OpenAI-format tool call (name + JSON args) to the AFM executor layer.
func executeTool(name: String, argsJSON: String) async throws -> String {
    let dict = (try? JSONSerialization.jsonObject(with: Data(argsJSON.utf8))) as? [String: Any] ?? [:]
    switch name {
    case "run_command":      return runCommandSync(dict["command"] as? String ?? "")
    case "read_file":        return readFileSync(dict["path"] as? String ?? "")
    case "write_file":       return writeFileSync(dict["path"] as? String ?? "", dict["content"] as? String ?? "")
    case "lsp_diagnostics":  return try await lspDiagSync(dict["filePath"] as? String ?? "")
    case "mcp_list_tools":   return mcpListSync(dict["serverCommand"] as? String ?? "")
    case "mcp_call":         return mcpCallSync(dict["serverCommand"] as? String ?? "", dict["toolName"] as? String ?? "", dict["arguments"] as? String ?? "")
    default:                 return "unknown tool: \(name)"
    }
}

// MARK: - Tool Implementations (AFM-native Tool structs over the shared executors)

@Generable struct RunCommandArgs { let command: String }
struct RunCommandTool: Tool {
    typealias Arguments = RunCommandArgs
    typealias Output = String
    var name: String { "run_command" }
    var description: String { "Execute a shell command and return stdout+stderr. Use for build, test, git, search, etc." }
    var includesSchemaInInstructions: Bool { true }
    func call(arguments: RunCommandArgs) async throws -> String {
        runCommandSync(arguments.command)
    }
}

@Generable struct ReadFileArgs { let path: String }
struct ReadFileTool: Tool {
    typealias Arguments = ReadFileArgs
    typealias Output = String
    var name: String { "read_file" }
    var description: String { "Read and return the contents of a file at the given path." }
    var includesSchemaInInstructions: Bool { true }
    func call(arguments: ReadFileArgs) async throws -> String {
        readFileSync(arguments.path)
    }
}

@Generable struct WriteFileArgs { let path: String; let content: String }
struct WriteFileTool: Tool {
    typealias Arguments = WriteFileArgs
    typealias Output = String
    var name: String { "write_file" }
    var description: String { "Write content to a file, creating or overwriting it." }
    var includesSchemaInInstructions: Bool { true }
    func call(arguments: WriteFileArgs) async throws -> String {
        writeFileSync(arguments.path, arguments.content)
    }
}

@Generable struct LspDiagArgs { let filePath: String }
struct LspDiagTool: Tool {
    typealias Arguments = LspDiagArgs
    typealias Output = String
    var name: String { "lsp_diagnostics" }
    var description: String { "Get LSP diagnostics (errors, warnings) for a source file. Supports .py, .swift, .ts, .js." }
    var includesSchemaInInstructions: Bool { true }
    func call(arguments: LspDiagArgs) async throws -> String {
        try await lspDiagSync(arguments.filePath)
    }
}

@Generable struct McpListArgs { let serverCommand: String }
struct McpListTool: Tool {
    typealias Arguments = McpListArgs
    typealias Output = String
    var name: String { "mcp_list_tools" }
    var description: String { "List available tools from an MCP server. Pass the command as a string (e.g. 'python3 /path/to/server.py')." }
    var includesSchemaInInstructions: Bool { true }
    func call(arguments: McpListArgs) async throws -> String {
        mcpListSync(arguments.serverCommand)
    }
}

@Generable struct McpCallArgs { let serverCommand: String; let toolName: String; let arguments: String }
struct McpCallTool: Tool {
    typealias Arguments = McpCallArgs
    typealias Output = String
    var name: String { "mcp_call" }
    var description: String { "Call a tool on an MCP server. Use mcp_list_tools first. arguments is a JSON object string." }
    var includesSchemaInInstructions: Bool { true }
    func call(arguments: McpCallArgs) async throws -> String {
        mcpCallSync(arguments.serverCommand, arguments.toolName, arguments.arguments)
    }
}

// MARK: - Tool Loop (multi-round, mirrors afm-agent.swift pattern)

func runToolLoop(
    model: SystemLanguageModel,
    prompt: String,
    tools: [any Tool],
    instructions: String
) async throws -> String {
    let options = GenerationOptions(maximumResponseTokens: 1024)
    let session1 = LanguageModelSession(model: model, tools: tools, instructions: instructions)
    let r1 = try await session1.respond(to: prompt, options: options)
    var entries = Array(session1.transcript)
    var calls: [Transcript.ToolCall] = []
    for entry in session1.transcript {
        if case let .toolCalls(cs) = entry { calls += Array(cs) }
    }

    if !calls.isEmpty {
        var outputs: [Transcript.Entry] = []
        for call in calls {
            do {
                let result: String
                switch call.toolName {
                case "run_command":
                    result = try await RunCommandTool().call(arguments: call.arguments.value(RunCommandArgs.self))
                case "read_file":
                    result = try await ReadFileTool().call(arguments: call.arguments.value(ReadFileArgs.self))
                case "write_file":
                    result = try await WriteFileTool().call(arguments: call.arguments.value(WriteFileArgs.self))
                case "lsp_diagnostics":
                    result = try await LspDiagTool().call(arguments: call.arguments.value(LspDiagArgs.self))
                case "mcp_list_tools":
                    result = try await McpListTool().call(arguments: call.arguments.value(McpListArgs.self))
                case "mcp_call":
                    result = try await McpCallTool().call(arguments: call.arguments.value(McpCallArgs.self))
                default:
                    result = "unknown tool: \(call.toolName)"
                }
                outputs.append(.toolOutput(Transcript.ToolOutput(
                    id: call.id, toolName: call.toolName,
                    segments: [.text(Transcript.TextSegment(id: call.id, content: result))]
                )))
            } catch {
                outputs.append(.toolOutput(Transcript.ToolOutput(
                    id: call.id, toolName: call.toolName,
                    segments: [.text(Transcript.TextSegment(id: call.id, content: "tool error: \(error.localizedDescription)"))]
                )))
            }
        }
        entries.append(contentsOf: outputs)
        let session2 = LanguageModelSession(model: model, tools: tools, transcript: Transcript(entries: entries))
        let r2 = try await session2.respond(to: "Answer with the tool results.", options: options)
        return r2.content
    }
    return r1.content
}

// MARK: - Brain/Executor Mode (capable model plans, AFM tool layer executes)

let brainSystemPrompt = """
You are the planning brain of a local agent. You decide which tool calls are needed; a fast \
on-device executor runs them and returns their exact output. Once you have the results, stop \
calling tools and answer the user concisely and grounded in the tool output. Never invent or \
paraphrase tool output. If a tool returns an error or exit code, say so.
"""

let brainToolSchemas: [[String: Any]] = [
    ["type": "function", "function": [
        "name": "run_command",
        "description": "Run a shell command and return stdout+stderr. Use for build, test, git, search, etc.",
        "parameters": ["type": "object", "properties": ["command": ["type": "string"]], "required": ["command"]]
    ]],
    ["type": "function", "function": [
        "name": "read_file",
        "description": "Read and return the contents of a file at the given path.",
        "parameters": ["type": "object", "properties": ["path": ["type": "string"]], "required": ["path"]]
    ]],
    ["type": "function", "function": [
        "name": "write_file",
        "description": "Write content to a file, creating or overwriting it.",
        "parameters": ["type": "object", "properties": [
            "path": ["type": "string"],
            "content": ["type": "string"]
        ], "required": ["path", "content"]]
    ]],
    ["type": "function", "function": [
        "name": "lsp_diagnostics",
        "description": "Get LSP diagnostics (errors, warnings) for a source file. Supports .py, .swift, .ts, .js.",
        "parameters": ["type": "object", "properties": ["filePath": ["type": "string"]], "required": ["filePath"]]
    ]],
    ["type": "function", "function": [
        "name": "mcp_list_tools",
        "description": "List available tools from an MCP server. Pass the command as a string (e.g. 'python3 /path/to/server.py').",
        "parameters": ["type": "object", "properties": ["serverCommand": ["type": "string"]], "required": ["serverCommand"]]
    ]],
    ["type": "function", "function": [
        "name": "mcp_call",
        "description": "Call a tool on an MCP server. Use mcp_list_tools first. arguments is a JSON object string.",
        "parameters": ["type": "object", "properties": [
            "serverCommand": ["type": "string"],
            "toolName": ["type": "string"],
            "arguments": ["type": "string"]
        ], "required": ["serverCommand", "toolName", "arguments"]]
    ]]
]

func brainCall(model: String, messages: [[String: Any]], tools: [[String: Any]]) async throws -> [String: Any] {
    var req = URLRequest(url: URL(string: "http://127.0.0.1:1234/v1/chat/completions")!)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body: [String: Any] = [
        "model": model, "messages": messages, "tools": tools,
        "tool_choice": "auto", "max_tokens": 2048, "temperature": 0
    ]
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    req.timeoutInterval = 120
    let (data, resp) = try await URLSession.shared.data(for: req)
    guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
        let snippet = String(data: data, encoding: .utf8) ?? "no body"
        return ["error": "HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1): \(String(snippet.prefix(300)))"]
    }
    return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
}

/// Planner/executor loop: capable model emits tool_calls, AFM tool layer executes them,
/// results return as role:tool messages, until the brain produces a final answer.
func runBrainLoop(model: String, prompt: String, maxRounds: Int = 10) async throws -> String {
    var messages: [[String: Any]] = [
        ["role": "system", "content": brainSystemPrompt],
        ["role": "user", "content": prompt]
    ]
    for round in 1...maxRounds {
        let resp = try await brainCall(model: model, messages: messages, tools: brainToolSchemas)
        if let err = resp["error"] { return "Brain error: \(err)" }
        guard let choice = (resp["choices"] as? [[String: Any]])?.first,
              let msg = choice["message"] as? [String: Any] else {
            return "Brain: malformed response \(String(describing: resp["error"] ?? resp))"
        }
        let content = msg["content"] as? String ?? ""
        let toolCalls = (msg["tool_calls"] as? [[String: Any]]) ?? []
        if toolCalls.isEmpty {
            return content.isEmpty ? "(brain returned empty response)" : content
        }
        // Assistant message carrying the tool_calls (content may be absent — omit, JSON can't encode nil)
        var assistantMsg: [String: Any] = ["role": "assistant", "tool_calls": toolCalls]
        if !content.isEmpty { assistantMsg["content"] = content }
        messages.append(assistantMsg)
        for tc in toolCalls {
            let fn = tc["function"] as? [String: Any] ?? [:]
            let name = fn["name"] as? String ?? ""
            let argsJSON = fn["arguments"] as? String ?? "{}"
            FileHandle.standardError.write("  [round \(round)] brain -> \(name) \(argsJSON)\n".data(using: .utf8)!)
            let result: String
            do { result = try await executeTool(name: name, argsJSON: argsJSON) }
            catch { result = "tool error: \(error.localizedDescription)" }
            messages.append(["role": "tool", "tool_call_id": tc["id"] as? String ?? "", "content": result])
        }
    }
    return "Brain: reached \(maxRounds) rounds without a final answer"
}

// MARK: - Main

@main
struct AFMAgentTools {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count > 1 else {
            print("usage: afm-agent-tools \"<question>\"")
            print("       afm-agent-tools --brain [<model-id>] \"<question>\"")
            print("       afm-agent-tools mcp-list \"python3 /path/to/server.py\"")
            print("       afm-agent-tools lsp-diag /path/to/file.py")
            return
        }

        // Brain/executor mode: capable model (e.g. qwen/qwen3.6-35b-a3b at 127.0.0.1:1234)
        // plans tool calls; the AFM tool layer executes them. No AFM model inference needed.
        if args[1] == "--brain" {
            let second = args.count > 2 ? args[2] : ""
            let hasModel = !second.isEmpty && !second.hasPrefix("-")
            let modelId = hasModel ? second : "qwen/qwen3.6-35b-a3b"
            let prompt = args.dropFirst(hasModel ? 3 : 2).joined(separator: " ")
            guard !prompt.isEmpty else {
                print("usage: afm-agent-tools --brain [<model-id>] \"<question>\"")
                return
            }
            let answer = try await runBrainLoop(model: modelId, prompt: prompt)
            print("[executor: afm (on-device tool layer) | brain: \(modelId)]")
            print(answer)
            return
        }

        let model = SystemLanguageModel.default
        guard model.isAvailable else {
            print("SystemLanguageModel not available")
            return
        }

        // Standalone MCP list mode
        if args[1] == "mcp-list", args.count > 2 {
            let cmd = args.dropFirst(2).joined(separator: " ")
            let result = try await McpListTool().call(arguments: McpListArgs(serverCommand: cmd))
            print(result)
            return
        }

        // Standalone LSP diagnostics mode
        if args[1] == "lsp-diag", args.count > 2 {
            let result = try await LspDiagTool().call(arguments: LspDiagArgs(filePath: args[2]))
            print(result)
            return
        }

        // Default: tool-augmented coding agent
        let prompt = args.dropFirst().joined(separator: " ")
        let tools: [any Tool] = [
            RunCommandTool(), ReadFileTool(), WriteFileTool(),
            LspDiagTool(), McpListTool(), McpCallTool()
        ]

        let result = try await runToolLoop(
            model: model,
            prompt: prompt,
            tools: tools,
            instructions: """
            You are an on-device coding assistant with access to shell commands, file operations, \
            LSP diagnostics, and MCP server tools. Use tools to investigate and solve the user's \
            request. After using tools, provide a clear summary of what you did and the results.
            """
        )
        print(result)
    }
}
