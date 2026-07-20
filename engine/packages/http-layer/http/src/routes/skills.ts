import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'

export async function listSkills(runtime: ServerRuntime): Promise<JsonResponse> {
  const v2 = runtime.skillsV2 ? await runtime.skillsV2() : null
  if (v2) {
    return jsonResponse({
      enabled: v2.enabled,
      roots: v2.roots,
      skills: v2.skills,
      validationErrors: v2.validationErrors,
      lastActivations: v2.lastActivations ?? []
    })
  }

  const diagnostics = runtime.skills
    ? await runtime.skills()
    : {
        enabled: false,
        roots: [],
        skills: [],
        validationErrors: [],
        lastActivations: []
      }
  return jsonResponse({
    enabled: diagnostics.enabled,
    roots: diagnostics.roots,
    skills: diagnostics.skills,
    validationErrors: diagnostics.validationErrors,
    lastActivations: diagnostics.lastActivations ?? []
  })
}
