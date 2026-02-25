use crate::agent::streaming::ToolDef;
use async_trait::async_trait;

/// Trait for self-contained agent tools. Each tool provides its own definition,
/// formatting, and execution logic. Adding a new tool = one struct implementing
/// this trait, zero changes to the agent loop.
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn definition(&self) -> ToolDef;
    fn format_description(&self, input: &serde_json::Value) -> String;
    fn format_command(&self, input: &serde_json::Value) -> String;
    async fn execute(&self, input: &serde_json::Value, workspace: &str) -> String;
}

/// Resolve a path relative to the workspace, with security validation.
/// Uses pure-logic normalization (no filesystem I/O) so it works even when
/// the workspace is still being cloned or the target file doesn't exist yet.
pub fn resolve_path_safe(path: &str, workspace: &str) -> Result<String, String> {
    use std::path::{Component, PathBuf};

    let raw = if path.starts_with('/') {
        PathBuf::from(path)
    } else {
        PathBuf::from(workspace).join(path)
    };

    // Normalize: collapse `.`, `..`, strip redundant separators — no I/O
    let mut normalized = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("Access denied: path '{}' escapes root", path));
                }
            }
            Component::CurDir => {} // skip `.`
            other => normalized.push(other),
        }
    }

    // Normalize workspace the same way for consistent prefix check
    let mut ws_normalized = PathBuf::new();
    for component in PathBuf::from(workspace).components() {
        match component {
            Component::ParentDir => {
                ws_normalized.pop();
            }
            Component::CurDir => {}
            other => ws_normalized.push(other),
        }
    }

    if !normalized.starts_with(&ws_normalized) {
        return Err(format!(
            "Access denied: path '{}' is outside the workspace boundary",
            path
        ));
    }

    Ok(normalized.to_string_lossy().to_string())
}

/// Build the full list of registered tools.
pub fn get_all_tools() -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(FileRead),
        Box::new(FileWrite),
        Box::new(FileEdit),
        Box::new(BashExec),
        Box::new(GrepTool),
        Box::new(ListDir),
    ]
}

/// Look up a tool by name and execute it.
pub async fn execute_tool_by_name(
    tools: &[Box<dyn Tool>],
    name: &str,
    input: &serde_json::Value,
    workspace: &str,
) -> String {
    for tool in tools {
        if tool.name() == name {
            return tool.execute(input, workspace).await;
        }
    }
    format!("Unknown tool: {}", name)
}

/// Look up a tool by name and format its description.
pub fn format_tool_description(
    tools: &[Box<dyn Tool>],
    name: &str,
    input: &serde_json::Value,
) -> String {
    for tool in tools {
        if tool.name() == name {
            return tool.format_description(input);
        }
    }
    format!("{}: {:?}", name, input)
}

/// Look up a tool by name and format its command string.
pub fn format_tool_command(
    tools: &[Box<dyn Tool>],
    name: &str,
    input: &serde_json::Value,
) -> String {
    for tool in tools {
        if tool.name() == name {
            return tool.format_command(input);
        }
    }
    serde_json::to_string(input).unwrap_or_default()
}

// --- Tool implementations ---

pub struct FileRead;

#[async_trait]
impl Tool for FileRead {
    fn name(&self) -> &str {
        "file_read"
    }

    fn definition(&self) -> ToolDef {
        ToolDef {
            name: "file_read".into(),
            description: "Read the contents of a file. Returns the full file content.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path relative to workspace, or absolute path" }
                },
                "required": ["path"]
            }),
        }
    }

    fn format_description(&self, input: &serde_json::Value) -> String {
        format!("Read: {}", input["path"].as_str().unwrap_or("?"))
    }

    fn format_command(&self, input: &serde_json::Value) -> String {
        format!("read {}", input["path"].as_str().unwrap_or("?"))
    }

    async fn execute(&self, input: &serde_json::Value, workspace: &str) -> String {
        let path = input["path"].as_str().unwrap_or("");
        let full_path = match resolve_path_safe(path, workspace) {
            Ok(p) => p,
            Err(e) => return e,
        };
        match std::fs::read_to_string(&full_path) {
            Ok(content) => {
                let lines = content.lines().count();
                if content.len() > 50_000 {
                    format!(
                        "{}\n\n... (truncated, {} lines total)",
                        &content[..50_000],
                        lines
                    )
                } else {
                    content
                }
            }
            Err(e) => format!("Error reading file: {}", e),
        }
    }
}

pub struct FileWrite;

#[async_trait]
impl Tool for FileWrite {
    fn name(&self) -> &str {
        "file_write"
    }

    fn definition(&self) -> ToolDef {
        ToolDef {
            name: "file_write".into(),
            description: "Write content to a file. Creates parent directories if needed.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path" },
                    "content": { "type": "string", "description": "Content to write" }
                },
                "required": ["path", "content"]
            }),
        }
    }

    fn format_description(&self, input: &serde_json::Value) -> String {
        let path = input["path"].as_str().unwrap_or("?");
        let len = input["content"].as_str().map(|s| s.len()).unwrap_or(0);
        format!("Write: {} ({} bytes)", path, len)
    }

    fn format_command(&self, input: &serde_json::Value) -> String {
        format!(
            "write {} ({} bytes)",
            input["path"].as_str().unwrap_or("?"),
            input["content"].as_str().map(|s| s.len()).unwrap_or(0)
        )
    }

    async fn execute(&self, input: &serde_json::Value, workspace: &str) -> String {
        let path = input["path"].as_str().unwrap_or("");
        let content = input["content"].as_str().unwrap_or("");
        let full_path = match resolve_path_safe(path, workspace) {
            Ok(p) => p,
            Err(e) => return e,
        };
        if let Some(parent) = std::path::Path::new(&full_path).parent() {
            std::fs::create_dir_all(parent).ok();
        }
        match std::fs::write(&full_path, content) {
            Ok(()) => format!("Written {} bytes to {}", content.len(), path),
            Err(e) => format!("Error writing file: {}", e),
        }
    }
}

pub struct FileEdit;

#[async_trait]
impl Tool for FileEdit {
    fn name(&self) -> &str {
        "file_edit"
    }

    fn definition(&self) -> ToolDef {
        ToolDef {
            name: "file_edit".into(),
            description: "Edit a file by replacing the first occurrence of old_text with new_text."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path" },
                    "old_text": { "type": "string", "description": "Text to find" },
                    "new_text": { "type": "string", "description": "Replacement text" }
                },
                "required": ["path", "old_text", "new_text"]
            }),
        }
    }

    fn format_description(&self, input: &serde_json::Value) -> String {
        format!("Edit: {}", input["path"].as_str().unwrap_or("?"))
    }

    fn format_command(&self, input: &serde_json::Value) -> String {
        format!("edit {}", input["path"].as_str().unwrap_or("?"))
    }

    async fn execute(&self, input: &serde_json::Value, workspace: &str) -> String {
        let path = input["path"].as_str().unwrap_or("");
        let old_text = input["old_text"].as_str().unwrap_or("");
        let new_text = input["new_text"].as_str().unwrap_or("");
        let full_path = match resolve_path_safe(path, workspace) {
            Ok(p) => p,
            Err(e) => return e,
        };
        match std::fs::read_to_string(&full_path) {
            Ok(content) => {
                if content.contains(old_text) {
                    let new_content = content.replacen(old_text, new_text, 1);
                    match std::fs::write(&full_path, &new_content) {
                        Ok(()) => format!("Edited {}", path),
                        Err(e) => format!("Error writing file: {}", e),
                    }
                } else {
                    format!("Text not found in {}", path)
                }
            }
            Err(e) => format!("Error reading file: {}", e),
        }
    }
}

pub struct BashExec;

#[async_trait]
impl Tool for BashExec {
    fn name(&self) -> &str {
        "bash_exec"
    }

    fn definition(&self) -> ToolDef {
        ToolDef {
            name: "bash_exec".into(),
            description: "Execute a shell command in the workspace directory. Use for commands that can't be done with other tools.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" },
                    "working_dir": { "type": "string", "description": "Working directory (optional, defaults to workspace)" }
                },
                "required": ["command"]
            }),
        }
    }

    fn format_description(&self, input: &serde_json::Value) -> String {
        let cmd = input["command"].as_str().unwrap_or("?");
        let truncated = if cmd.len() > 80 { &cmd[..80] } else { cmd };
        format!("Bash: `{}`", truncated)
    }

    fn format_command(&self, input: &serde_json::Value) -> String {
        input["command"].as_str().unwrap_or("").to_string()
    }

    async fn execute(&self, input: &serde_json::Value, workspace: &str) -> String {
        let command = input["command"].as_str().unwrap_or("");
        let working_dir = input["working_dir"].as_str().unwrap_or(workspace);

        match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            tokio::process::Command::new("sh")
                .arg("-c")
                .arg(command)
                .current_dir(working_dir)
                .kill_on_drop(true)
                .output(),
        )
        .await
        {
            Ok(Ok(out)) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let stderr = String::from_utf8_lossy(&out.stderr);
                let mut result = String::new();
                if !stdout.is_empty() {
                    result.push_str(&stdout);
                }
                if !stderr.is_empty() {
                    if !result.is_empty() {
                        result.push('\n');
                    }
                    result.push_str("STDERR: ");
                    result.push_str(&stderr);
                }
                if result.is_empty() {
                    result = format!("Exit code: {}", out.status.code().unwrap_or(-1));
                }
                if result.len() > 20_000 {
                    result.truncate(20_000);
                    result.push_str("\n... (truncated)");
                }
                result
            }
            Ok(Err(e)) => format!("Error executing command: {}", e),
            Err(_) => "Command timed out after 30 seconds".to_string(),
        }
    }
}

pub struct GrepTool;

#[async_trait]
impl Tool for GrepTool {
    fn name(&self) -> &str {
        "grep"
    }

    fn definition(&self) -> ToolDef {
        ToolDef {
            name: "grep".into(),
            description: "Search for a regex pattern in files. Returns matching lines with file paths and line numbers.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "Regex pattern to search for" },
                    "path": { "type": "string", "description": "File or directory to search in (defaults to workspace root)" },
                    "include": { "type": "string", "description": "Glob pattern for files to include (e.g. '*.rs')" }
                },
                "required": ["pattern"]
            }),
        }
    }

    fn format_description(&self, input: &serde_json::Value) -> String {
        format!(
            "Grep: '{}' in {}",
            input["pattern"].as_str().unwrap_or("?"),
            input["path"].as_str().unwrap_or(".")
        )
    }

    fn format_command(&self, input: &serde_json::Value) -> String {
        format!(
            "grep '{}' in {}",
            input["pattern"].as_str().unwrap_or("?"),
            input["path"].as_str().unwrap_or(".")
        )
    }

    async fn execute(&self, input: &serde_json::Value, workspace: &str) -> String {
        let pattern_str = input["pattern"].as_str().unwrap_or("");
        let path = input["path"].as_str().unwrap_or(".");
        let include = input["include"].as_str();
        let full_path = match resolve_path_safe(path, workspace) {
            Ok(p) => p,
            Err(e) => return e,
        };

        let re = match regex::Regex::new(pattern_str) {
            Ok(r) => r,
            Err(e) => return format!("Invalid regex '{}': {}", pattern_str, e),
        };

        // Compile glob filter once before the walk loop
        let glob_matcher = if let Some(glob_pattern) = include {
            match globset::GlobBuilder::new(glob_pattern)
                .literal_separator(false)
                .build()
            {
                Ok(g) => Some(g.compile_matcher()),
                Err(e) => return format!("Invalid glob pattern '{}': {}", glob_pattern, e),
            }
        } else {
            None
        };

        let mut results = Vec::new();
        let walker = walkdir::WalkDir::new(&full_path)
            .max_depth(15)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                // Skip hidden dirs, node_modules, target, .git
                !(e.file_type().is_dir()
                    && (name.starts_with('.') || name == "node_modules" || name == "target"))
            });

        for entry in walker.filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }

            // Apply include glob filter (supports *.rs, **/*.rs, *.{ts,tsx}, etc.)
            if let Some(ref matcher) = glob_matcher {
                let rel_path = entry
                    .path()
                    .strip_prefix(&full_path)
                    .unwrap_or(entry.path());
                if !matcher.is_match(rel_path)
                    && !matcher.is_match(entry.file_name().to_string_lossy().as_ref())
                {
                    continue;
                }
            }

            if let Ok(content) = std::fs::read_to_string(entry.path()) {
                for (i, line) in content.lines().enumerate() {
                    if re.is_match(line) {
                        results.push(format!(
                            "{}:{}: {}",
                            entry.path().display(),
                            i + 1,
                            line.trim()
                        ));
                        if results.len() >= 100 {
                            break;
                        }
                    }
                }
            }
            if results.len() >= 100 {
                break;
            }
        }
        if results.is_empty() {
            format!("No matches found for '{}'", pattern_str)
        } else {
            let count = results.len();
            let mut out = results.join("\n");
            if count >= 100 {
                out.push_str("\n... (limited to 100 matches)");
            }
            out
        }
    }
}

pub struct ListDir;

#[async_trait]
impl Tool for ListDir {
    fn name(&self) -> &str {
        "list_dir"
    }

    fn definition(&self) -> ToolDef {
        ToolDef {
            name: "list_dir".into(),
            description: "List directory contents with file types.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Directory path" }
                },
                "required": ["path"]
            }),
        }
    }

    fn format_description(&self, input: &serde_json::Value) -> String {
        format!("List: {}", input["path"].as_str().unwrap_or("."))
    }

    fn format_command(&self, input: &serde_json::Value) -> String {
        format!("ls {}", input["path"].as_str().unwrap_or("."))
    }

    async fn execute(&self, input: &serde_json::Value, workspace: &str) -> String {
        let path = input["path"].as_str().unwrap_or(".");
        let full_path = match resolve_path_safe(path, workspace) {
            Ok(p) => p,
            Err(e) => return e,
        };
        match std::fs::read_dir(&full_path) {
            Ok(entries) => {
                let mut items: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| {
                        let name = e.file_name().to_string_lossy().to_string();
                        let meta = e.metadata().ok();
                        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                        if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            format!("{}/", name)
                        } else {
                            format!("{} ({} bytes)", name, size)
                        }
                    })
                    .collect();
                items.sort();
                if items.is_empty() {
                    "(empty directory)".to_string()
                } else {
                    items.join("\n")
                }
            }
            Err(e) => format!("Error listing directory: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- resolve_path_safe tests ---

    #[test]
    fn resolve_path_safe_normal_relative() {
        let result = resolve_path_safe("src/main.rs", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project/src/main.rs");
    }

    #[test]
    fn resolve_path_safe_dot_segments() {
        let result = resolve_path_safe("src/./main.rs", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project/src/main.rs");
    }

    #[test]
    fn resolve_path_safe_traversal_blocked() {
        let result = resolve_path_safe("../../../etc/passwd", "/workspace/project");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_path_safe_traversal_via_subdirectory() {
        let result = resolve_path_safe("foo/../../..", "/workspace/project");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_path_safe_absolute_inside_workspace() {
        let result = resolve_path_safe("/workspace/project/src/lib.rs", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project/src/lib.rs");
    }

    #[test]
    fn resolve_path_safe_absolute_outside_workspace() {
        let result = resolve_path_safe("/etc/passwd", "/workspace/project");
        assert!(result.is_err());
    }

    #[test]
    fn resolve_path_safe_empty_path() {
        let result = resolve_path_safe("", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project");
    }

    #[test]
    fn resolve_path_safe_nested_parent_traversal() {
        let result = resolve_path_safe("src/../Cargo.toml", "/workspace/project");
        assert_eq!(result.unwrap(), "/workspace/project/Cargo.toml");
    }

    // --- Tool trait tests ---

    #[test]
    fn all_tools_have_unique_names() {
        let tools = get_all_tools();
        let mut names: Vec<&str> = tools.iter().map(|t| t.name()).collect();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), tools.len());
    }

    #[test]
    fn all_tools_produce_valid_definitions() {
        let tools = get_all_tools();
        for tool in &tools {
            let def = tool.definition();
            assert_eq!(def.name, tool.name());
            assert!(!def.description.is_empty());
            assert!(def.input_schema.is_object());
        }
    }

    #[test]
    fn format_description_file_read() {
        let tools = get_all_tools();
        let input = serde_json::json!({"path": "src/main.rs"});
        assert_eq!(
            format_tool_description(&tools, "file_read", &input),
            "Read: src/main.rs"
        );
    }

    #[test]
    fn format_description_file_write() {
        let tools = get_all_tools();
        let input = serde_json::json!({"path": "out.txt", "content": "hello world"});
        let desc = format_tool_description(&tools, "file_write", &input);
        assert!(desc.contains("Write: out.txt"));
        assert!(desc.contains("11 bytes"));
    }

    #[test]
    fn format_description_bash_truncates() {
        let tools = get_all_tools();
        let long_cmd = "a".repeat(200);
        let input = serde_json::json!({"command": long_cmd});
        let desc = format_tool_description(&tools, "bash_exec", &input);
        assert!(desc.starts_with("Bash: `"));
        assert!(desc.len() < 100);
    }

    #[test]
    fn format_description_grep() {
        let tools = get_all_tools();
        let input = serde_json::json!({"pattern": "TODO", "path": "src/"});
        assert_eq!(
            format_tool_description(&tools, "grep", &input),
            "Grep: 'TODO' in src/"
        );
    }

    #[test]
    fn format_description_list_dir() {
        let tools = get_all_tools();
        let input = serde_json::json!({"path": "."});
        assert_eq!(
            format_tool_description(&tools, "list_dir", &input),
            "List: ."
        );
    }

    #[test]
    fn format_description_unknown_tool() {
        let tools = get_all_tools();
        let input = serde_json::json!({"foo": "bar"});
        let desc = format_tool_description(&tools, "nonexistent", &input);
        assert!(desc.contains("nonexistent"));
    }
}
