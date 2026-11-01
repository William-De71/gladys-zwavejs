import type { SceneActionFields, SceneActionOutputs } from '@gladysassistant/integration-sdk'

import type { ZwaveApi } from '../zwave/ZwaveApi.ts'
import type { ZwaveApiName } from '../zwave/topics.ts'

/** Configuration command class: a parameter is written as its property. */
const CONFIGURATION_CC = 112

/** zwave-js `InclusionStrategy`, limited to what the scene action offers. */
const INCLUSION_STRATEGY = {
  default: 0,
  insecure: 2,
} as const

/**
 * zwave-js `SetValueStatus` values meaning the device took the write:
 * Working (1, a transition in progress), SuccessUnsupervised (254) and
 * Success (255).
 */
const WRITE_ACCEPTED = new Set([1, 254, 255])

/**
 * Each scene action waits for zwave-js-ui a little less than the core waits
 * for the action (`timeout_seconds` in the manifest), so the scene gets an
 * answer from us — "queued", "failed" — rather than a bare core timeout.
 */
const ACTION_MARGIN_MS = 5_000

/** The scene action keys, as declared in the manifest. */
export const SCENE_ACTIONS = {
  PING_NODE: 'ping_node',
  REFRESH_VALUES: 'refresh_values',
  REBUILD_NODE_ROUTES: 'rebuild_node_routes',
  REBUILD_NETWORK_ROUTES: 'rebuild_network_routes',
  SET_CONFIG_PARAMETER: 'set_config_parameter',
  START_INCLUSION: 'start_inclusion',
  START_EXCLUSION: 'start_exclusion',
  STOP_INCLUSION_EXCLUSION: 'stop_inclusion_exclusion',
} as const

/** `timeout_seconds` of each scene action — mirrored by the manifest, asserted by the tests. */
export const SCENE_ACTION_TIMEOUTS_S: Readonly<Record<string, number>> = {
  [SCENE_ACTIONS.PING_NODE]: 30,
  [SCENE_ACTIONS.REFRESH_VALUES]: 60,
  [SCENE_ACTIONS.REBUILD_NODE_ROUTES]: 120,
  [SCENE_ACTIONS.REBUILD_NETWORK_ROUTES]: 20,
  [SCENE_ACTIONS.SET_CONFIG_PARAMETER]: 60,
  [SCENE_ACTIONS.START_INCLUSION]: 20,
  [SCENE_ACTIONS.START_EXCLUSION]: 20,
  [SCENE_ACTIONS.STOP_INCLUSION_EXCLUSION]: 20,
}

const apiTimeout = (action: string) =>
  (SCENE_ACTION_TIMEOUTS_S[action] ?? 30) * 1000 - ACTION_MARGIN_MS

/** Thrown when zwave-js-ui does not answer in time — for a sleeping node, not a failure. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.includes('did not answer')
}

/**
 * The network operations offered to the scenes and to the network widget:
 * everything Z-Wave JS UI can do that is not a device feature.
 *
 * None of them fires a scene trigger in return — a scene bound to "node back
 * online" that pings nodes would otherwise loop through the integration.
 */
export class NetworkOperations {
  private readonly api: ZwaveApi
  private readonly selector: string

  constructor(api: ZwaveApi, selector: string) {
    this.api = api
    this.selector = selector
  }

  /** Dispatch a scene action by key. */
  async run(action: string, fields: SceneActionFields): Promise<SceneActionOutputs | undefined> {
    switch (action) {
      case SCENE_ACTIONS.PING_NODE:
        return this.ping(fields)
      case SCENE_ACTIONS.REFRESH_VALUES: {
        const { completed } = await this.queued(action, 'refreshValues', [this.nodeOf(fields)])
        return { completed }
      }
      case SCENE_ACTIONS.REBUILD_NODE_ROUTES:
        return this.rebuildNodeRoutes(fields)
      case SCENE_ACTIONS.REBUILD_NETWORK_ROUTES:
        return this.rebuildNetworkRoutes()
      case SCENE_ACTIONS.SET_CONFIG_PARAMETER:
        return this.setConfigParameter(fields)
      case SCENE_ACTIONS.START_INCLUSION:
        return this.startInclusion(fields)
      case SCENE_ACTIONS.START_EXCLUSION:
        return this.started(action, 'startExclusion', [])
      case SCENE_ACTIONS.STOP_INCLUSION_EXCLUSION:
        return this.stopInclusionExclusion()
      default:
        throw new Error(`Unknown scene action "${action}"`)
    }
  }

  /** Ask zwave-js-ui to rebuild the routes of the whole network. */
  async rebuildNetworkRoutes(): Promise<SceneActionOutputs> {
    return this.started(SCENE_ACTIONS.REBUILD_NETWORK_ROUTES, 'beginRebuildingRoutes', [{}])
  }

  /**
   * The node id behind a `source: "devices"` field: the core hands over the
   * chosen device external id, `ext:<selector>:<nodeId>`.
   */
  private nodeOf(fields: SceneActionFields): number {
    const device = fields.device
    const prefix = `ext:${this.selector}:`
    if (typeof device !== 'string' || !device.startsWith(prefix)) {
      throw new Error('Pick a Z-Wave device')
    }
    const suffix = device.slice(prefix.length)
    const nodeId = Number(suffix)
    if (!/^\d+$/.test(suffix) || !Number.isInteger(nodeId)) {
      throw new Error(`"${device}" is not a Z-Wave device`)
    }
    return nodeId
  }

  private async ping(fields: SceneActionFields): Promise<SceneActionOutputs> {
    const result = await this.api.call(
      'pingNode',
      [this.nodeOf(fields)],
      apiTimeout(SCENE_ACTIONS.PING_NODE),
    )
    return { alive: result === true }
  }

  private async rebuildNodeRoutes(fields: SceneActionFields): Promise<SceneActionOutputs> {
    const outputs = await this.queued(SCENE_ACTIONS.REBUILD_NODE_ROUTES, 'rebuildNodeRoutes', [
      this.nodeOf(fields),
    ])
    return outputs.completed === true && outputs.result === false
      ? { completed: true, success: false }
      : { completed: outputs.completed, success: outputs.completed === true }
  }

  private async setConfigParameter(fields: SceneActionFields): Promise<SceneActionOutputs> {
    const nodeId = this.nodeOf(fields)
    const parameter = fields.parameter
    const value = fields.value
    if (typeof parameter !== 'number' || !Number.isInteger(parameter) || parameter < 1) {
      throw new Error('The parameter number must be a positive integer')
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error('The parameter value must be an integer')
    }
    const valueId = { nodeId, commandClass: CONFIGURATION_CC, endpoint: 0, property: parameter }
    const outputs = await this.queued(SCENE_ACTIONS.SET_CONFIG_PARAMETER, 'writeValue', [
      valueId,
      value,
    ])
    if (outputs.completed !== true) {
      return { completed: false, success: false }
    }
    // zwave-js-ui answers a `SetValueResult` ({ status }) on recent versions,
    // a bare boolean on older ones.
    const status = (outputs.result as { status?: unknown } | null)?.status
    const success =
      typeof status === 'number' ? WRITE_ACCEPTED.has(status) : outputs.result === true
    if (!success) {
      throw new Error(`Node ${nodeId} refused value ${value} for parameter ${parameter}`)
    }
    return { completed: true, success: true }
  }

  private startInclusion(fields: SceneActionFields): Promise<SceneActionOutputs> {
    const strategy =
      fields.security === 'insecure' ? INCLUSION_STRATEGY.insecure : INCLUSION_STRATEGY.default
    return this.started(SCENE_ACTIONS.START_INCLUSION, 'startInclusion', [strategy, {}])
  }

  private async stopInclusionExclusion(): Promise<undefined> {
    // Both, in sequence: the scene author does not have to remember which
    // one was started, and stopping the one that is not running is a no-op
    // zwave-js answers with `false`.
    const timeout = apiTimeout(SCENE_ACTIONS.STOP_INCLUSION_EXCLUSION) / 2
    await this.api.call('stopInclusion', [], timeout)
    await this.api.call('stopExclusion', [], timeout)
    return undefined
  }

  /** An API answering whether something started. */
  private async started(
    action: string,
    api: ZwaveApiName,
    args: readonly unknown[],
  ): Promise<SceneActionOutputs> {
    const result = await this.api.call(api, args, apiTimeout(action))
    return { started: result === true }
  }

  /**
   * An API that a sleeping node only answers at its next wake-up — minutes or
   * hours later. zwave-js keeps the request queued until then, so running out
   * of time here is not a failure: it is reported as `completed: false`, and
   * the request still reaches the node when it wakes up.
   */
  private async queued(
    action: string,
    api: ZwaveApiName,
    args: readonly unknown[],
  ): Promise<{ completed: boolean; result?: unknown }> {
    try {
      const result = await this.api.call(api, args, apiTimeout(action))
      return { completed: true, result }
    } catch (error) {
      if (isTimeout(error)) {
        return { completed: false }
      }
      throw error
    }
  }
}
