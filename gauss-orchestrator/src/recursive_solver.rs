use crate::code_indexer::CodeIssue;
use crate::multi_agent::{MultiAgentOrchestrator, TaskType};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecursiveTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub parent_id: Option<String>,
    pub depth: u32,
    pub status: TaskStatus,
    pub result: Option<String>,
    pub assigned_role: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TaskStatus {
    Pending,
    Decomposing,
    Executing,
    Completed,
    Failed,
}

pub struct RecursiveOrchestrator {
    multi_agent: MultiAgentOrchestrator,
    max_depth: u32,
}

impl RecursiveOrchestrator {
    pub fn new(multi_agent: MultiAgentOrchestrator, max_depth: u32) -> Self {
        Self {
            multi_agent,
            max_depth,
        }
    }

    pub async fn solve_issue(&self, issue: &CodeIssue) -> Result<String, String> {
        let mut task_queue = VecDeque::new();

        let root_task = RecursiveTask {
            id: "root".to_string(),
            title: format!("Resolve issue: {}", issue.id),
            description: issue.description.clone(),
            parent_id: None,
            depth: 0,
            status: TaskStatus::Pending,
            result: None,
            assigned_role: None,
        };

        task_queue.push_back(root_task);
        let mut completed_tasks = Vec::new();

        while let Some(mut task) = task_queue.pop_front() {
            if task.depth >= self.max_depth {
                // Leaf node or max depth reached, try to solve directly
                println!(
                    "[recursive-solver] 🎯 Max depth reached or atomic task: {}",
                    task.id
                );
                let res = self.execute_task(&task).await?;
                task.result = Some(res);
                task.status = TaskStatus::Completed;
                completed_tasks.push(task);
                continue;
            }

            // Ask the models if this task needs decomposition
            let needs_decomp = self.should_decompose(&task).await?;

            if needs_decomp {
                println!("[recursive-solver] 🧩 Decomposing task: {}", task.id);
                let sub_tasks = self.decompose_task(&task).await?;
                for mut sub_task in sub_tasks {
                    sub_task.parent_id = Some(task.id.clone());
                    sub_task.depth = task.depth + 1;
                    task_queue.push_back(sub_task);
                }
                task.status = TaskStatus::Decomposing;
                completed_tasks.push(task);
            } else {
                println!("[recursive-solver] 🚀 Executing atomic task: {}", task.id);
                let res = self.execute_task(&task).await?;
                task.result = Some(res);
                task.status = TaskStatus::Completed;
                completed_tasks.push(task);
            }
        }

        // Aggregate results
        self.synthesize_final_result(completed_tasks).await
    }

    async fn should_decompose(&self, task: &RecursiveTask) -> Result<bool, String> {
        let prompt = format!(
            "Task: {}\nDescription: {}\nDepth: {}\n\nDoes this task need to be broken down into smaller sub-tasks to be solved effectively? Respond with 'YES' or 'NO' followed by a brief reason.",
            task.title, task.description, task.depth
        );

        let res = self
            .multi_agent
            .route_by_task(TaskType::RecursiveDecomposition, &prompt)
            .await?;
        Ok(res.consensus.to_uppercase().contains("YES"))
    }

    async fn decompose_task(&self, task: &RecursiveTask) -> Result<Vec<RecursiveTask>, String> {
        let prompt = format!(
            "Task: {}\nDescription: {}\n\nBreak this task down into a list of 2-5 atomic sub-tasks. For each sub-task, provide a title and a detailed description. Format the output as a JSON array of objects with 'title' and 'description' keys.",
            task.title, task.description
        );

        let res = self
            .multi_agent
            .route_by_task(TaskType::RecursiveDecomposition, &prompt)
            .await?;

        // Find JSON in response
        let json_start = res
            .consensus
            .find('[')
            .ok_or("No JSON found in decomposition response")?;
        let json_end = res
            .consensus
            .rfind(']')
            .ok_or("No JSON found in decomposition response")?
            + 1;
        let json_str = &res.consensus[json_start..json_end];

        #[derive(Deserialize)]
        struct RawSubTask {
            title: String,
            description: String,
        }

        let raw_tasks: Vec<RawSubTask> = serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse sub-tasks: {}", e))?;

        Ok(raw_tasks
            .into_iter()
            .enumerate()
            .map(|(i, t)| RecursiveTask {
                id: format!("{}.{}", task.id, i + 1),
                title: t.title,
                description: t.description,
                parent_id: Some(task.id.clone()),
                depth: task.depth + 1,
                status: TaskStatus::Pending,
                result: None,
                assigned_role: None,
            })
            .collect())
    }

    async fn execute_task(&self, task: &RecursiveTask) -> Result<String, String> {
        let prompt = format!(
            "Execute the following task:\nTitle: {}\nDescription: {}\n\nProvide the code or instructions to complete this task.",
            task.title, task.description
        );

        let res = self
            .multi_agent
            .route_by_task(TaskType::CodeGeneration, &prompt)
            .await?;
        Ok(res.consensus)
    }

    async fn synthesize_final_result(&self, tasks: Vec<RecursiveTask>) -> Result<String, String> {
        let completed = tasks
            .iter()
            .filter(|t| t.status == TaskStatus::Completed)
            .collect::<Vec<_>>();

        let mut report = String::from("Final Resolution Summary:\n\n");
        for task in completed {
            report.push_str(&format!(
                "### Task {}: {}\nResult: {}\n\n",
                task.id,
                task.title,
                task.result.as_ref().unwrap_or(&"No result".to_string())
            ));
        }

        let prompt = format!(
            "Synthesize the following task results into a final cohesive solution summary:\n\n{}",
            report
        );

        let res = self
            .multi_agent
            .route_by_task(TaskType::Comprehension, &prompt)
            .await?;
        Ok(res.consensus)
    }
}
