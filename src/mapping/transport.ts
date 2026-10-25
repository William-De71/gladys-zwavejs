import {
  DEVICE_TRANSPORTS,
  type DeviceTransport,
  type MultiLanguageMessage,
} from '@gladysassistant/integration-sdk'

import type { ZwaveNode } from '../types/zwave.ts'

/** The badge of one node, before it is given a device external id. */
export interface NodeTransport {
  transport: DeviceTransport
  degraded?: true
  message?: MultiLanguageMessage
}

/**
 * zwave-js `NodeStatus`, by its numeric value.
 *
 * zwave-js-ui speaks two dialects: `getNodes` names the status (`"Asleep"`),
 * while the node events (`node_dead`, `node_value_updated`...) carry the raw
 * zwave-js enum, a number. The cache ends up holding either, so both are read.
 */
const NODE_STATUSES = ['unknown', 'asleep', 'awake', 'dead', 'alive'] as const

type NodeStatus = (typeof NODE_STATUSES)[number]

export function nodeStatus(raw: unknown): NodeStatus {
  if (typeof raw === 'number') {
    return NODE_STATUSES[raw] ?? 'unknown'
  }
  if (typeof raw === 'string') {
    const name = raw.toLowerCase()
    return NODE_STATUSES.find((status) => status === name) ?? 'unknown'
  }
  return 'unknown'
}

const INTERVIEW_INCOMPLETE: MultiLanguageMessage = {
  en: 'Interview not complete: some features may be missing until the node finishes it.',
  fr: "Interview incomplète : des fonctionnalités peuvent manquer tant que le nœud ne l'a pas terminée.",
}

/**
 * What the Gladys badge should say about a node.
 *
 * Asleep is the NOMINAL state of a battery device, not a failure: it wakes up
 * on its own schedule and its reports still come through, so it reads as
 * `local` like a node that is awake. Only Dead — zwave-js gave up reaching it —
 * is unreachable.
 *
 * Unknown publishes nothing: zwave-js reports it until it has had a chance to
 * talk to the node, and claiming either way would be a guess. The badge keeps
 * whatever it said before.
 *
 * A node that is not `ready` is flagged degraded: it answers, but its
 * interview is unfinished, which is precisely the case behind a device showing
 * fewer features than expected.
 */
export function nodeTransport(node: ZwaveNode): NodeTransport | undefined {
  const status = nodeStatus(node.status)
  if (status === 'unknown') {
    return undefined
  }
  const transport = status === 'dead' ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL
  return node.ready === true
    ? { transport }
    : { transport, degraded: true, message: INTERVIEW_INCOMPLETE }
}
