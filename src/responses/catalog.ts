import { Model } from './types';
/** Codex-native metadata enables freeform apply_patch for non-OpenAI model IDs. */
export function codexCatalog(models: Model[]): unknown {
    return { models: models.filter(m=>m.kind!=='embedding').map((m, index) => ({
            slug: m.id, display_name: m.name, description: 'Copilot model exposed through your local proxy',
            base_instructions: 'You are a coding assistant working in the user-provided workspace. Follow the user request and all system/developer instructions. Inspect relevant files before editing. Use the provided shell and apply_patch tools to make focused changes, then verify the result. Respect tool permissions, never expose credentials, and report material limitations honestly.',
            default_reasoning_level: null, supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true, priority: index,
            availability_nux: null, upgrade: null, include_apps_usage_instructions: false, supports_reasoning_summary_parameter: false, default_reasoning_summary: 'none',
            support_verbosity: false, default_verbosity: null, apply_patch_tool_type: 'freeform', truncation_policy: { mode: 'bytes', limit: 10000 },
            context_window: m.contextWindow ?? null, experimental_supported_tools: [], input_modalities: m.capabilities.images === false ? ['text'] : ['text', 'image'],
            supports_search_tool: false, supports_experimental_context: false, use_responses_lite: false, supports_reasoning_effort_updates: false
        })) };
}
