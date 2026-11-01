import type { TopicSettings } from '../config.ts'

/**
 * The Z-Wave JS UI topic tree.
 *
 * Every topic derives from the prefix and the gateway name, which are fixed
 * (see TOPIC_SETTINGS) and mirrored by the setup instructions the user follows
 * in Z-Wave JS UI.
 */
export interface Topics {
  /** Response carrying the full node list. */
  readonly getNodesResponse: string
  /** Request asking for the full node list. */
  readonly getNodesRequest: string
  /** Invoke a command class method (`set`, `stopLevelChange`...). */
  readonly sendCommand: string
  /** Write a value directly (`restorePrevious`...). */
  readonly writeValue: string
  /** Root of the node events; the last segment is the event name. */
  readonly nodeEvents: string
  /** Request topic of any zwave-js-ui API (`pingNode`, `rebuildNodeRoutes`...). */
  readonly apiRequest: (api: ZwaveApiName) => string
  /** Topic zwave-js-ui answers an API call on: the request topic without `/set`. */
  readonly apiResponse: (api: ZwaveApiName) => string
  /** What to subscribe to on every connection. */
  readonly subscriptions: readonly string[]
}

/**
 * The zwave-js-ui APIs the integration calls AND awaits the answer of — the
 * scene actions and the network widget. Listed explicitly: each one is a
 * subscription, and listening to the whole `api/#` branch would also deliver
 * the answer of every command written by `sendCommand` and `writeValue`, or by
 * any other MQTT client of the same broker.
 */
export const AWAITED_APIS = [
  'pingNode',
  'refreshValues',
  'rebuildNodeRoutes',
  'beginRebuildingRoutes',
  'startInclusion',
  'stopInclusion',
  'startExclusion',
  'stopExclusion',
  'writeValue',
] as const

export type ZwaveApiName = (typeof AWAITED_APIS)[number]

export function buildTopics({ prefix, gateway }: TopicSettings): Topics {
  const client = `${prefix}/_CLIENTS/${gateway}`
  const nodeEvents = `${prefix}/_EVENTS/${gateway}/node`
  const getNodesResponse = `${client}/api/getNodes`

  return {
    getNodesResponse,
    getNodesRequest: `${getNodesResponse}/set`,
    sendCommand: `${client}/api/sendCommand/set`,
    writeValue: `${client}/api/writeValue/set`,
    nodeEvents,
    apiRequest: (api) => `${client}/api/${api}/set`,
    apiResponse: (api) => `${client}/api/${api}`,
    // The node event branch is taken as a whole rather than topic by topic:
    // zwave-js-ui publishes several lifecycle events there (node_ready,
    // node_added, node_removed, node_value_updated...) and matching the branch
    // survives that list changing. It stays narrow: only this gateway, only
    // node events — not the value tree, which we never read from MQTT.
    subscriptions: [
      getNodesResponse,
      `${nodeEvents}/#`,
      ...AWAITED_APIS.map((api) => `${client}/api/${api}`),
    ],
  }
}

/** Event name of a node event topic, e.g. `node_value_updated`. */
export function nodeEventName(topic: string, topics: Topics): string | undefined {
  const root = `${topics.nodeEvents}/`
  return topic.startsWith(root) ? topic.slice(root.length) : undefined
}
