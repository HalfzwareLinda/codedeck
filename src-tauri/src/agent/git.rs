use anyhow::Result;

/// Clone a git repository into the workspace directory.
pub async fn git_clone(repo_url: &str, branch: &str, workspace_path: &str) -> Result<String> {
    if repo_url.is_empty() {
        return Ok("No repo URL provided, workspace is empty.".to_string());
    }

    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("clone");

    if !branch.is_empty() {
        cmd.arg("--branch").arg(branch);
    }

    cmd.arg("--depth").arg("1");
    cmd.arg(repo_url).arg(workspace_path);

    let output = tokio::time::timeout(std::time::Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| anyhow::anyhow!("Git clone timed out after 120 seconds"))?
        .map_err(|e| anyhow::anyhow!("Failed to run git clone: {}", e))?;

    if output.status.success() {
        Ok("Repository cloned successfully.".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(anyhow::anyhow!("Git clone failed: {}", stderr))
    }
}

/// Execute git push in the workspace directory.
pub async fn git_push_in_workspace(workspace_path: &str) -> Result<String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        tokio::process::Command::new("git")
            .args(["push"])
            .current_dir(workspace_path)
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Git push timed out after 60 seconds"))?
    .map_err(|e| anyhow::anyhow!("Failed to run git push: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        Ok(format!("{}{}", stdout, stderr))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(anyhow::anyhow!("Git push failed: {}", stderr))
    }
}

/// Execute git pull in the workspace directory.
pub async fn git_pull_in_workspace(workspace_path: &str) -> Result<String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        tokio::process::Command::new("git")
            .args(["pull"])
            .current_dir(workspace_path)
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("Git pull timed out after 60 seconds"))?
    .map_err(|e| anyhow::anyhow!("Failed to run git pull: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(anyhow::anyhow!("Git pull failed: {}", stderr))
    }
}
