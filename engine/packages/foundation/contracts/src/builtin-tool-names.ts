export const CREATE_PLAN_TOOL_NAME = 'create_plan'

export const GET_GOAL_TOOL_NAME = 'get_goal'
export const CREATE_GOAL_TOOL_NAME = 'create_goal'
export const UPDATE_GOAL_TOOL_NAME = 'update_goal'
export const GOAL_TOOL_NAMES = [
  GET_GOAL_TOOL_NAME,
  CREATE_GOAL_TOOL_NAME,
  UPDATE_GOAL_TOOL_NAME
] as const

export const TODO_LIST_TOOL_NAME = 'todo_list'
export const TODO_WRITE_TOOL_NAME = 'todo_write'
export const TODO_TOOL_NAMES = [TODO_LIST_TOOL_NAME, TODO_WRITE_TOOL_NAME] as const
