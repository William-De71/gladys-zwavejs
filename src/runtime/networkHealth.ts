import {
  WIDGET_BUTTON_STYLES,
  WIDGET_COLORS,
  WIDGET_TEXT_VARIANTS,
  type WidgetColor,
  type WidgetComponent,
  type WidgetContent,
} from '@gladysassistant/integration-sdk'

import { buildDeviceName } from '../mapping/DeviceMapper.ts'
import { nodeStatus } from '../mapping/transport.ts'
import type { ZwaveNode } from '../types/zwave.ts'
import { batteryReading } from '../zwave/commandClasses/battery.ts'

/** Key of the network widget in the manifest. */
export const NETWORK_WIDGET = 'network'

/** Keys of the widget buttons, relayed to `onWidgetAction`. */
export const NETWORK_WIDGET_ACTIONS = {
  REFRESH: 'refresh',
  REBUILD_ROUTES: 'rebuild_routes',
} as const

/** What can be wrong with one node, by decreasing severity. */
type Problem = 'dead' | 'battery' | 'interview'

const SEVERITY: Readonly<Record<Problem, number>> = { dead: 0, battery: 1, interview: 2 }

export interface NodeProblem {
  readonly node: ZwaveNode
  readonly problem: Problem
  /** Battery level, for a `battery` problem. */
  readonly level?: number
}

export interface NetworkSummary {
  /** Real nodes: neither the controller nor the broadcast pseudo-nodes. */
  readonly total: number
  readonly dead: number
  readonly asleep: number
  readonly lowBattery: number
  /** One entry per node and problem, most severe first. */
  readonly problems: readonly NodeProblem[]
}

/**
 * The network at a glance, from the cached `getNodes` view.
 *
 * A node can carry several problems at once (dead AND low battery: the
 * battery is probably why it died); each is listed, the most severe first, so
 * the overview never hides the cause behind the symptom.
 */
export function summarizeNetwork(nodes: readonly ZwaveNode[]): NetworkSummary {
  const real = nodes.filter((node) => node.virtual !== true && node.isControllerNode !== true)
  const problems: NodeProblem[] = []
  let dead = 0
  let asleep = 0
  let lowBattery = 0

  for (const node of real) {
    const status = nodeStatus(node.status)
    if (status === 'dead') {
      dead += 1
      problems.push({ node, problem: 'dead' })
    } else if (status === 'asleep') {
      asleep += 1
    }
    const battery = batteryReading(node)
    if (battery?.low) {
      lowBattery += 1
      problems.push({
        node,
        problem: 'battery',
        ...(battery.level === undefined ? {} : { level: battery.level }),
      })
    }
    if (node.ready !== true && status !== 'dead') {
      problems.push({ node, problem: 'interview' })
    }
  }

  problems.sort((a, b) => SEVERITY[a.problem] - SEVERITY[b.problem] || a.node.id - b.node.id)
  return { total: real.length, dead, asleep, lowBattery, problems }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

/** The widget speaks French to French users, English to everybody else. */
type Lang = 'fr' | 'en'

const TEXTS = {
  nodes: { fr: 'Nœuds', en: 'Nodes' },
  dead: { fr: 'Ne répondent plus', en: 'Not responding' },
  lowBattery: { fr: 'Piles faibles', en: 'Low batteries' },
  asleep: { fr: 'Endormis', en: 'Asleep' },
  network: { fr: 'Réseau', en: 'Network' },
  allGood: { fr: 'Aucun problème', en: 'No problem' },
  deadNode: { fr: 'Ne répond plus', en: 'Not responding' },
  lowBatteryNode: { fr: 'Pile faible', en: 'Low battery' },
  interview: { fr: 'Interview incomplète', en: 'Interview incomplete' },
  refresh: { fr: 'Actualiser', en: 'Refresh' },
  rebuild: { fr: 'Réparer les routes', en: 'Rebuild routes' },
  empty: {
    fr: "Aucun nœud Z-Wave connu pour l'instant. Vérifiez la connexion au broker MQTT et la configuration de Z-Wave JS UI.",
    en: 'No Z-Wave node known yet. Check the MQTT broker connection and the Z-Wave JS UI settings.',
  },
} as const

/** The status list holds 10 rows; the 10th says how many more there are. */
const MAX_STATUS_ROWS = 10
/** Status labels and values are cut by the core beyond 40 characters. */
const MAX_STATUS_TEXT = 40

function truncate(text: string, max = MAX_STATUS_TEXT): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** "12 min", "5 h", "3 j" / "3 d" — a dead node's silence, at a glance. */
function since(lastActive: number | undefined, now: number, lang: Lang): string | undefined {
  if (typeof lastActive !== 'number' || lastActive <= 0 || lastActive > now) {
    return undefined
  }
  const minutes = Math.floor((now - lastActive) / 60_000)
  if (minutes < 60) {
    return `${Math.max(minutes, 1)} min`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return `${hours} h`
  }
  return `${Math.floor(hours / 24)} ${lang === 'fr' ? 'j' : 'd'}`
}

function problemRow(
  entry: NodeProblem,
  now: number,
  lang: Lang,
): { label: string; value: string; color: WidgetColor } {
  const label = truncate(`${entry.node.id} · ${buildDeviceName(entry.node)}`)
  switch (entry.problem) {
    case 'dead': {
      const silence = since(entry.node.lastActive, now, lang)
      const value = silence ? `${TEXTS.deadNode[lang]} (${silence})` : TEXTS.deadNode[lang]
      return { label, value: truncate(value), color: WIDGET_COLORS.DANGER }
    }
    case 'battery':
      return {
        label,
        value: entry.level === undefined ? TEXTS.lowBatteryNode[lang] : `${entry.level} %`,
        color: WIDGET_COLORS.WARNING,
      }
    default:
      return { label, value: TEXTS.interview[lang], color: WIDGET_COLORS.INFO }
  }
}

/**
 * The network widget: four counters, the list of what needs attention, and
 * the two buttons a user reaches for when something is off — ask Z-Wave JS UI
 * again, and rebuild the routes of the whole network.
 */
export function buildNetworkWidget(
  nodes: readonly ZwaveNode[],
  { language, now = Date.now() }: { language: string; now?: number },
): WidgetContent {
  const lang: Lang = language.toLowerCase().startsWith('fr') ? 'fr' : 'en'
  const refresh: WidgetComponent = {
    type: 'button',
    label: TEXTS.refresh[lang],
    icon: 'refresh-cw',
    style: WIDGET_BUTTON_STYLES.SECONDARY,
    action: { key: NETWORK_WIDGET_ACTIONS.REFRESH },
  }

  const summary = summarizeNetwork(nodes)
  if (summary.total === 0) {
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: WIDGET_TEXT_VARIANTS.BODY, text: TEXTS.empty[lang] },
        refresh,
      ],
    }
  }

  const rows = summary.problems.map((entry) => problemRow(entry, now, lang))
  if (rows.length > MAX_STATUS_ROWS) {
    const hidden = rows.length - (MAX_STATUS_ROWS - 1)
    rows.splice(MAX_STATUS_ROWS - 1, rows.length, {
      label: '…',
      value: lang === 'fr' ? `${hidden} autres` : `${hidden} more`,
      color: WIDGET_COLORS.NEUTRAL,
    })
  }

  return {
    ttl_seconds: 300,
    components: [
      { type: 'value', label: TEXTS.nodes[lang], value: summary.total, icon: 'share-2' },
      {
        type: 'value',
        label: TEXTS.dead[lang],
        value: summary.dead,
        icon: 'wifi-off',
        color: summary.dead > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
      },
      {
        type: 'value',
        label: TEXTS.lowBattery[lang],
        value: summary.lowBattery,
        icon: 'battery',
        color: summary.lowBattery > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
      },
      { type: 'value', label: TEXTS.asleep[lang], value: summary.asleep, icon: 'moon' },
      {
        type: 'status',
        items:
          rows.length > 0
            ? rows
            : [
                {
                  label: TEXTS.network[lang],
                  value: TEXTS.allGood[lang],
                  color: WIDGET_COLORS.SUCCESS,
                },
              ],
      },
      refresh,
      {
        type: 'button',
        label: TEXTS.rebuild[lang],
        icon: 'tool',
        style: WIDGET_BUTTON_STYLES.SECONDARY,
        action: { key: NETWORK_WIDGET_ACTIONS.REBUILD_ROUTES, confirm: true },
      },
    ],
  }
}
