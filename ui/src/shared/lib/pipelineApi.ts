import { api } from './apiClient'

export interface PipelineStepData {
  step_order: number
  agent_definition_id: string
  command_template: string
}

export interface Pipeline {
  id: string
  project_id: string
  name: string
  steps: (PipelineStepData & { id: string })[]
  created_at: string
}

export async function fetchPipelines(projectId: string): Promise<Pipeline[]> {
  return api.get(`/projects/${projectId}/pipelines`)
}

export async function createPipeline(
  projectId: string,
  name: string,
  steps: PipelineStepData[],
): Promise<Pipeline> {
  return api.post(`/projects/${projectId}/pipelines`, { name, steps })
}

export async function deletePipeline(projectId: string, pipelineId: string): Promise<void> {
  return api.delete(`/projects/${projectId}/pipelines/${pipelineId}`)
}

export async function fetchAllUserPipelines(): Promise<Pipeline[]> {
  return api.get('/pipelines')
}

export async function clonePipelineToProject(
  pipelineId: string,
  targetProjectId: string,
): Promise<Pipeline> {
  return api.post(`/pipelines/${pipelineId}/clone?target_project_id=${targetProjectId}`, {})
}
